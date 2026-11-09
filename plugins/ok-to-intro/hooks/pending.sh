#!/bin/sh
# OK to Intro · SessionStart hook (matcher startup|resume, timeout 3 s).
# Prints one JSON object ({"systemMessage": …, "hookSpecificOutput": …}) when something waits on you: at most 3 lines
# for you, the same facts for Claude. Prints nothing when nothing waits, without a token, without curl, on any error,
# or after 2 seconds. The token is the plugin option (kept in the OS keychain, passed as CLAUDE_PLUGIN_OPTION_TOKEN);
# it goes to curl on stdin, never as a command-line argument.
# Usage: pending.sh <https://host/api/hook>   (hooks.json passes the URL; scripts/build-plugin.ts writes it)

url="${1:-}"
token="${CLAUDE_PLUGIN_OPTION_TOKEN:-}"

case "$token" in oti_*) ;; *) exit 0 ;; esac
case "$url" in https://*|http://localhost:*|http://127.0.0.1:*) ;; *) exit 0 ;; esac
command -v curl >/dev/null 2>&1 || exit 0

body=$(printf 'Authorization: Bearer %s\n' "$token" | curl --silent --fail --max-time 2 --header @- --header 'Accept: application/json' "$url" 2>/dev/null) || exit 0

case "$body" in
  '{'*'"systemMessage"'*) printf '%s\n' "$body" ;;
esac
exit 0
