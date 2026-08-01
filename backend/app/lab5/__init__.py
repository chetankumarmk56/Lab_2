"""Lab 5 — On-the-Fly MCP Server Builder service package.

A non-technical user connects their own database and the app generates, deploys
(in-process, via create_sdk_mcp_server), registers, and verifies a READ-ONLY MCP
query server — reusing the project's existing in-process MCP model. Read-only is
enforced by four independent, fail-closed layers (AST validation, read-only DB
session, least-privilege credential, driver hardening). Target-DB passwords are
Fernet-encrypted at rest and never logged, returned, or placed in generated code.
"""
