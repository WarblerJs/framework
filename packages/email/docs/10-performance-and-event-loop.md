# Performance And Event Loop

Message preparation is async and avoids blocking source compilation at runtime.
Base64 streaming carries 0-2 leftover bytes between chunks so non-3-aligned
stream chunks encode correctly.
