#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <wchar.h>

#define PATH_CAPACITY 32768
static FILE *log_file = NULL;
static wchar_t log_path[PATH_CAPACITY] = L"";

static void log_event(const wchar_t *event, DWORD code) {
  SYSTEMTIME now;
  if (!log_file) return;
  GetLocalTime(&now);
  fwprintf(log_file, L"[%04u-%02u-%02u %02u:%02u:%02u] pid=%lu %ls; code=%lu\n",
           now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond,
           GetCurrentProcessId(), event, code);
  fflush(log_file);
}

static void log_path_value(const wchar_t *label, const wchar_t *value) {
  if (!log_file) return;
  fwprintf(log_file, L"%ls: \"%ls\"\n", label, value);
  fflush(log_file);
}

static void open_log(const wchar_t *own_path) {
  const wchar_t *slash = wcsrchr(own_path, L'\\');
  wchar_t temp_path[MAX_PATH];
  DWORD temp_length;
  size_t directory_length = slash ? (size_t)(slash - own_path + 1) : 0;
  if (directory_length > 0 && directory_length + wcslen(L"install-launcher.log") < PATH_CAPACITY) {
    wcsncpy_s(log_path, PATH_CAPACITY, own_path, directory_length);
    wcscat_s(log_path, PATH_CAPACITY, L"install-launcher.log");
    _wfopen_s(&log_file, log_path, L"a, ccs=UTF-8");
  }
  temp_length = GetTempPathW(MAX_PATH, temp_path);
  if (!log_file && temp_length > 0 && temp_length < MAX_PATH &&
      swprintf_s(log_path, PATH_CAPACITY, L"%lsinstall-launcher-%lu.log",
                 temp_path, GetCurrentProcessId()) > 0) {
    _wfopen_s(&log_file, log_path, L"a, ccs=UTF-8");
  }
  if (!log_file) log_path[0] = L'\0';
  log_event(L"Launcher started", 0);
  log_path_value(L"Launcher", own_path);
}

static void show_error(const wchar_t *message, DWORD code) {
  wchar_t text[PATH_CAPACITY + 256];
  log_event(message, code);
  swprintf_s(text, sizeof(text) / sizeof(text[0]),
             L"%ls\nWindows 错误码：%lu\n安装日志：%ls", message, code,
             log_path[0] ? log_path : L"无法创建日志文件");
  MessageBoxW(NULL, text, L"小智酒店管家安装", MB_OK | MB_ICONERROR);
}

static BOOL process_is_running(const wchar_t *name, DWORD *error_code) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  PROCESSENTRY32W entry;
  BOOL found = FALSE;
  if (snapshot == INVALID_HANDLE_VALUE) {
    *error_code = GetLastError();
    return FALSE;
  }
  entry.dwSize = sizeof(entry);
  if (!Process32FirstW(snapshot, &entry)) {
    *error_code = GetLastError();
    CloseHandle(snapshot);
    return FALSE;
  }
  do {
    if (_wcsicmp(entry.szExeFile, name) == 0) {
      found = TRUE;
      break;
    }
  } while (Process32NextW(snapshot, &entry));
  if (!found && GetLastError() != ERROR_NO_MORE_FILES) *error_code = GetLastError();
  CloseHandle(snapshot);
  return found;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command_line, int show) {
  wchar_t own_path[PATH_CAPACITY];
  wchar_t application_name[MAX_PATH];
  wchar_t mutex_name[MAX_PATH + 32];
  wchar_t setup_path[PATH_CAPACITY] = L"";
  wchar_t launch_command[PATH_CAPACITY + 4];
  const wchar_t *base_name;
  const wchar_t *suffix = L"安装程序.exe";
  size_t prefix_length;
  HANDLE mutex = NULL;
  STARTUPINFOW startup = { 0 };
  PROCESS_INFORMATION child = { 0 };
  DWORD error_code = 0;
  DWORD child_exit = 1;
  DWORD own_length;
  DWORD setup_attributes;
  int result = 1;
  (void)instance; (void)previous; (void)show;

  own_length = GetModuleFileNameW(NULL, own_path, PATH_CAPACITY);
  if (own_length == 0 || own_length >= PATH_CAPACITY) {
    show_error(L"无法确定安装程序路径。",
               own_length == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER);
    return 1;
  }
  open_log(own_path);
  base_name = wcsrchr(own_path, L'\\');
  base_name = base_name ? base_name + 1 : own_path;
  prefix_length = wcslen(base_name);
  if (prefix_length <= wcslen(suffix) ||
      _wcsicmp(base_name + prefix_length - wcslen(suffix), suffix) != 0) {
    show_error(L"安装程序文件名不正确。", 0); return 1;
  }
  prefix_length -= wcslen(suffix);
  if (prefix_length + wcslen(L".exe") + 1 > MAX_PATH) {
    show_error(L"安装程序文件名过长。", 0); return 1;
  }
  wcsncpy_s(application_name, MAX_PATH, base_name, prefix_length);
  wcscat_s(application_name, MAX_PATH, L".exe");
  if (wcslen(L"setup.exe") + (size_t)(base_name - own_path) + 1 > PATH_CAPACITY) {
    show_error(L"原始安装程序路径过长。", 0); return 1;
  }
  wcsncpy_s(setup_path, PATH_CAPACITY, own_path, (size_t)(base_name - own_path));
  wcscat_s(setup_path, PATH_CAPACITY, L"setup.exe");
  log_path_value(L"Original setup", setup_path);
  setup_attributes = GetFileAttributesW(setup_path);
  if (setup_attributes == INVALID_FILE_ATTRIBUTES || (setup_attributes & FILE_ATTRIBUTE_DIRECTORY)) {
    show_error(L"找不到同目录的原始 Setup。请完整解压发布 ZIP 后再运行安装程序。",
               setup_attributes == INVALID_FILE_ATTRIBUTES ? GetLastError() : ERROR_DIRECTORY);
    if (log_file) fclose(log_file);
    return 1;
  }
  if (swprintf_s(mutex_name, MAX_PATH + 32, L"Local\\XiaozhiSetup-%ls", application_name) < 0) {
    show_error(L"无法创建安装锁。", 0); return 1;
  }
  mutex = CreateMutexW(NULL, TRUE, mutex_name);
  if (!mutex) { show_error(L"无法创建安装锁。", GetLastError()); return 1; }
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    show_error(L"另一个安装程序正在运行。请等待它结束后再试。", 0);
    CloseHandle(mutex);
    return 2;
  }

  if (process_is_running(application_name, &error_code)) {
    show_error(L"小智酒店管家仍在运行。请先完全退出程序，再重新安装。", 0);
    result = 2;
    goto cleanup;
  }
  if (error_code != 0) {
    show_error(L"无法检查程序是否正在运行。", error_code);
    goto cleanup;
  }
  log_event(L"Process check passed", 0);
  error_code = 0;
  if (process_is_running(application_name, &error_code)) {
    show_error(L"小智酒店管家刚刚启动。请先退出程序，再重新安装。", 0);
    result = 2;
    goto cleanup;
  }
  if (error_code != 0) {
    show_error(L"无法检查程序是否正在运行。", error_code);
    goto cleanup;
  }
  if (swprintf_s(launch_command, PATH_CAPACITY + 4, L"\"%ls\"", setup_path) < 0) {
    show_error(L"安装程序路径过长。", 0);
    goto cleanup;
  }
  startup.cb = sizeof(startup);
  log_event(L"Starting original setup", 0);
  if (!CreateProcessW(setup_path, launch_command, NULL, NULL, FALSE, 0,
                      NULL, NULL, &startup, &child)) {
    show_error(L"无法启动原始安装程序。", GetLastError());
    goto cleanup;
  }
  if (WaitForSingleObject(child.hProcess, INFINITE) != WAIT_OBJECT_0 ||
      !GetExitCodeProcess(child.hProcess, &child_exit)) {
    show_error(L"等待安装程序结束时发生错误。", GetLastError());
    goto cleanup;
  }
  result = (int)child_exit;
  log_event(L"Installer exit code", child_exit);
  if (child_exit != 0) show_error(L"原始安装程序未成功完成。请将安装日志发给技术支持。", child_exit);
  else if (_wcsicmp(command_line, L"--no-success-dialog") != 0) {
    wchar_t text[PATH_CAPACITY + 128];
    swprintf_s(text, sizeof(text) / sizeof(text[0]),
               L"原始安装程序已退出（退出码 0）。请确认应用能够正常打开。\n安装日志：%ls",
               log_path[0] ? log_path : L"无法创建日志文件");
    MessageBoxW(NULL, text, L"小智酒店管家安装", MB_OK | MB_ICONINFORMATION);
  }

cleanup:
  if (child.hThread) CloseHandle(child.hThread);
  if (child.hProcess) CloseHandle(child.hProcess);
  log_event(GetFileAttributesW(own_path) == INVALID_FILE_ATTRIBUTES
                ? L"Launcher file missing after install" : L"Launcher file retained after install", 0);
  log_event(GetFileAttributesW(setup_path) == INVALID_FILE_ATTRIBUTES
                ? L"Original setup missing after install" : L"Original setup retained after install", 0);
  if (mutex) { ReleaseMutex(mutex); CloseHandle(mutex); }
  if (log_file) fclose(log_file);
  return result;
}
