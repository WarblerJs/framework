# Overview

`@warbler/email` owns email normalization, validation, MIME encoding, and
transport delivery. Warbler views own HTML rendering. Application code wires
events or jobs to `Email.send()`.

The default constructor resolves configuration once and reuses one transport
instance. No source templates are compiled by this package at send time.
