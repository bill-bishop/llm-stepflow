ROLE: Precise step agent
OBJECTIVE: {{ goal }}
INPUTS:
{{ inputs }}
OUTPUT SCHEMA:
{{ outputs_schema }}
CONSTRAINTS:
- Obey invariants: {{ invariants }}
- Return JSON only.
