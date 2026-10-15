#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <wchar.h>

#define SETUP_RESOURCE_ID 101
#define PATH_CAPACITY 32768

static void show_error(const wchar_t *message, DWORD code) {
  wchar_t text[512];
  if (code == 0) {
    MessageBoxW(NULL, message, L"小智酒店管家安装", MB_OK | MB_ICONERROR);
    return;
  }
  swprintf_s(text, sizeof(text) / sizeof(text[0]), L"%ls\nWindows 错误码：%lu", message, code);
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

static BOOL extract_setup(wchar_t *directory, wchar_t *setup_path, size_t setup_path_size,
                          DWORD *error_code) {
  wchar_t temp_path[MAX_PATH];
  DWORD temp_length;
  HRSRC resource;
  HGLOBAL loaded;
  const BYTE *bytes;
  DWORD size;
  HANDLE output;
  DWORD offset = 0;

  resource = FindResourceW(NULL, MAKEINTRESOURCEW(SETUP_RESOURCE_ID), RT_RCDATA);
  if (!resource) { *error_code = GetLastError(); return FALSE; }
  loaded = LoadResource(NULL, resource);
  if (!loaded) { *error_code = GetLastError(); return FALSE; }
  bytes = (const BYTE *)LockResource(loaded);
  size = SizeofResource(NULL, resource);
  if (!bytes || size == 0) { *error_code = ERROR_RESOURCE_DATA_NOT_FOUND; return FALSE; }

  temp_length = GetTempPathW(MAX_PATH, temp_path);
  if (temp_length == 0 || temp_length >= MAX_PATH) {
    *error_code = temp_length == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER;
    return FALSE;
  }
  if (!GetTempFileNameW(temp_path, L"XZI", 0, directory)) {
    *error_code = GetLastError(); return FALSE;
  }
  if (!DeleteFileW(directory) || !CreateDirectoryW(directory, NULL)) {
    *error_code = GetLastError(); return FALSE;
  }
  if (swprintf_s(setup_path, setup_path_size, L"%ls\\squirrel-setup.exe", directory) < 0) {
    *error_code = ERROR_INSUFFICIENT_BUFFER; return FALSE;
  }
  output = CreateFileW(setup_path, GENERIC_WRITE, 0, NULL, CREATE_NEW,
                       FILE_ATTRIBUTE_NORMAL, NULL);
  if (output == INVALID_HANDLE_VALUE) { *error_code = GetLastError(); return FALSE; }
  while (offset < size) {
    DWORD written = 0;
    if (!WriteFile(output, bytes + offset, size - offset, &written, NULL) || written == 0) {
      *error_code = GetLastError();
      CloseHandle(output);
      return FALSE;
    }
    offset += written;
  }
  if (!CloseHandle(output)) { *error_code = GetLastError(); return FALSE; }
  return TRUE;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command_line, int show) {
  wchar_t own_path[PATH_CAPACITY];
  wchar_t application_name[MAX_PATH];
  wchar_t mutex_name[MAX_PATH + 32];
  wchar_t temp_directory[MAX_PATH] = L"";
  wchar_t setup_path[MAX_PATH + 32] = L"";
  wchar_t launch_command[MAX_PATH + 40];
  const wchar_t *base_name;
  const wchar_t *suffix = L"-setup.exe";
  size_t prefix_length;
  HANDLE mutex = NULL;
  STARTUPINFOW startup = { 0 };
  PROCESS_INFORMATION child = { 0 };
  DWORD error_code = 0;
  DWORD child_exit = 1;
  DWORD own_length;
  int result = 1;
  (void)instance; (void)previous; (void)command_line; (void)show;

  own_length = GetModuleFileNameW(NULL, own_path, PATH_CAPACITY);
  if (own_length == 0 || own_length >= PATH_CAPACITY) {
    show_error(L"无法确定安装程序路径。",
               own_length == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER);
    return 1;
  }
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
  if (!extract_setup(temp_directory, setup_path, MAX_PATH + 32, &error_code)) {
    show_error(L"无法准备原始安装程序。", error_code);
    goto cleanup;
  }
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
  if (swprintf_s(launch_command, MAX_PATH + 40, L"\"%ls\"", setup_path) < 0) {
    show_error(L"安装程序路径过长。", 0);
    goto cleanup;
  }
  startup.cb = sizeof(startup);
  if (!CreateProcessW(setup_path, launch_command, NULL, NULL, FALSE, 0,
                      NULL, temp_directory, &startup, &child)) {
    show_error(L"无法启动原始安装程序。", GetLastError());
    goto cleanup;
  }
  if (WaitForSingleObject(child.hProcess, INFINITE) != WAIT_OBJECT_0 ||
      !GetExitCodeProcess(child.hProcess, &child_exit)) {
    show_error(L"等待安装程序结束时发生错误。", GetLastError());
    goto cleanup;
  }
  result = (int)child_exit;

cleanup:
  if (child.hThread) CloseHandle(child.hThread);
  if (child.hProcess) CloseHandle(child.hProcess);
  if (setup_path[0]) DeleteFileW(setup_path);
  if (temp_directory[0]) RemoveDirectoryW(temp_directory);
  if (mutex) { ReleaseMutex(mutex); CloseHandle(mutex); }
  return result;
}
