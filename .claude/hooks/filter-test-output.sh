#!/bin/bash
# § 55.1 (2026-10-05) — PreToolUse hook on Bash (.claude/settings.json), after the example of the
# official «Manage costs» page (code.claude.com/docs/en/costs, «Offload processing to hooks and
# skills»): a test or mutation command is rewritten to go through .claude/hooks/quiet-filter.mjs,
# which keeps the failures and the summary and drops the rest. Every other command is left as it is.
#
# What is rewritten — ONE plain command (after an optional «cd <dir> &&»), nothing piped, redirected
# or chained, and no VERBOSE=1:
#   npm test [-- names]                      node tests/run.mjs [names]
#   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/<name>.test.mts
#   node scripts/mutation/s45-20260930-mutations-all.mjs [--only= --jobs= --out=]   (isolated copies)
#   node scripts/mutation/s41-20260926-mutation-scan.mjs                            (read only)
#   node scripts/mutation/<name>-mutations.mjs [parts]     filtered, NOT auto-approved: it edits src/
#                                                          in the tree it runs in
# The exit code of the command is kept (the filter exits with it).
# jq reads and writes the hook's JSON when it is installed; node (the project needs it anyway) otherwise.

input=$(cat)
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skip() { echo "{}"; exit 0; }

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
else
  cmd=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).tool_input?.command??""))}catch{}})')
fi
[ -z "$cmd" ] && skip
case "$cmd" in *VERBOSE=1*) skip ;; esac

# an optional «cd <dir> &&», then the command itself (trimmed)
lead=""; rest="$cmd"
if [[ "$cmd" =~ ^[[:space:]]*(cd[[:space:]]+[A-Za-z0-9_./~-]+[[:space:]]*\&\&[[:space:]]*)(.*)$ ]]; then
  lead="${BASH_REMATCH[1]}"; rest="${BASH_REMATCH[2]}"
fi
rest="${rest#"${rest%%[![:space:]]*}"}"; rest="${rest%"${rest##*[![:space:]]}"}"

# anything the shell reads as more than plain words ends it here: no pipe, redirect, list, substitution, quote
case "$rest" in
  *[\;\&\|\<\>\`\$\(\)\{\}\'\"\\\*\?\!\#]*) skip ;;
  *$'\n'*) skip ;;
esac

N='[A-Za-z0-9._-]+'          # a file name
W='[^[:space:]]+'            # a word (a part's letter: أ ب ج …) — the special characters are ruled out above
runner="^(npm (run )?test( --)?( (tests/)?$N)*|node (\./)?tests/run\.mjs( (tests/)?$N)*)$"
file="^node --experimental-strip-types --experimental-loader=\./tests/loader\.mjs (\./)?tests/$N\.test\.mts$"
all="^node (\./)?scripts/mutation/(s41-20260926-mutation-scan\.mjs|s45-20260930-mutations-all\.mjs( --(jobs=[0-9]+|only=[A-Za-z0-9,._-]+|out=(scripts/artifacts|docs/history)/$N\.txt))*)$"
one="^node (\./)?scripts/mutation/$N-mutations\.mjs( $W)*$"

# light: the command is quiet already (one line per file or script) — only its «✓» lines go.
# raw: a test file or a mutation script on its own prints every check — the filter reads it all.
if [[ "$rest" =~ $runner || "$rest" =~ $all ]]; then mode=""; decision="allow"
elif [[ "$rest" =~ $file ]]; then mode=" --raw"; decision="allow"
elif [[ "$rest" =~ $one ]]; then mode=" --raw"; decision=""
else skip
fi

new="${lead}{ ${rest}; echo \"::utak-rc=\$?\"; } 2>&1 | node \"${here}/quiet-filter.mjs\"${mode}"
reason="test / mutation output through .claude/hooks/quiet-filter.mjs (failures and summary only; VERBOSE=1 for all)"

if command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | jq -c --arg c "$new" --arg d "$decision" --arg r "$reason" \
    '{hookSpecificOutput: ({hookEventName: "PreToolUse", updatedInput: (.tool_input + {command: $c})} + (if $d == "" then {} else {permissionDecision: $d, permissionDecisionReason: $r} end))}'
else
  printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{const [c,d,r]=process.argv.slice(1);const i=JSON.parse(s);const o={hookEventName:"PreToolUse",updatedInput:{...i.tool_input,command:c}};if(d){o.permissionDecision=d;o.permissionDecisionReason=r}process.stdout.write(JSON.stringify({hookSpecificOutput:o})+"\n")})' "$new" "$decision" "$reason"
fi
