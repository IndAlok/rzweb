export const TRIAGE_PROMPT = `Perform a first-pass triage of the binary in context_id={context_id}.
Use binary_info, list_strings, and list_functions. Inspect the entry function and main with function_briefing and decompile.
Summarize what the binary is, its likely purpose, notable imports or strings, and anything that warrants a deeper look.`;

export const ANALYZE_FUNCTION_PROMPT = `Analyze the function at {address} in context_id={context_id}.
Start with function_briefing for bounds, xrefs, in-range strings, and decompilation. Then disasm if you need the instruction listing.
Explain what the function does, its inputs and outputs, and flag unsafe patterns.`;

export const FIND_VULNS_PROMPT = `Look for common vulnerability patterns in context_id={context_id}.
Use list_functions and list_strings, then function_briefing on call sites of risky imports such as strcpy, gets, sprintf, system, memcpy, malloc, and free.
Report buffer overflows, format-string bugs, command injection, integer overflows, or use-after-free with an address and a reason for each.`;
