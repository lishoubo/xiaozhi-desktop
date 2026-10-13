## Purpose

在不干扰内嵌渠道网页原有交互的前提下，给支持人员提供原生网页对话框的来源证据，以便区分小智员工登录态与渠道页面自身的提示。

## ADDED Requirements

### Requirement: Record embedded web dialog origin
The desktop application SHALL log the type, channel, tab identifier, and site origin when an embedded web page invokes a native JavaScript dialog. It SHALL NOT log the dialog message, prompt input, credentials, or URL path and query.

#### Scenario: Dialog from an active tab
- **WHEN** an active embedded page invokes alert, confirm, or prompt
- **THEN** the application records its source metadata and the native dialog retains its original behavior

#### Scenario: Dialog from a background tab
- **WHEN** a retained embedded page invokes a dialog after the user navigates to another application page
- **THEN** the application records the same source metadata without suppressing the dialog

### Requirement: Preserve embedded page behavior
The diagnostic mechanism SHALL call the original dialog function with its original arguments and return its result to the page.

#### Scenario: Confirmation result
- **WHEN** a page invokes confirm and the user selects a result
- **THEN** the page receives that result unchanged
