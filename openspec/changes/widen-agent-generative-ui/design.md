# Design: Widen Agent generative UI

The conversation content container increases from `max-w-3xl` to `max-w-5xl`. Message width is then
selected by content type: user and text-only assistant messages retain the existing bounded width,
while an assistant message with `ui` uses the available row width. Its Markdown text remains capped
at the existing readable measure and only the generated UI expands.

The in-flight draft path follows the same rule for defensive compatibility even though committed-only
UI normally prevents draft specs. The composer stays `max-w-3xl`, preserving comfortable input line
length. Existing table overflow rules remain the containment boundary for small windows.
