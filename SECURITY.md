# Security

Do not share real Lark app secrets, session secrets, token encryption keys, D1 database IDs, or Cloudflare account identifiers in issues.

If you find a security issue, please open a private advisory when possible, or contact the repository maintainer privately.

Important implementation details:

- Lark access and refresh tokens are encrypted with AES-GCM before being stored in D1.
- Browser sessions are stored as HMAC hashes in D1.
- API requests from ordinary website origins are rejected; Chrome extension origins are allowed by CORS.
- Generated files containing deployment-specific values are ignored by git.
