# Security

The package validates addresses, headers, custom headers, content IDs, attachment
paths, recipient counts, message size, attachment size, SMTP response size, and
SMTP command strings before unsafe I/O. `.env`, hidden folders, `node_modules`,
and unsafe path traversal are rejected for attachments.
