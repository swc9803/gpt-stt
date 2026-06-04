# Billing Kill Switch

This Cloud Function listens to the `billing-kill-switch` Pub/Sub topic. When the
monthly budget notification reports `costAmount >= budgetAmount`, it disconnects
Cloud Billing from `gpt-stt-parent`.

This is intentionally disruptive: disconnecting billing stops paid Google Cloud
services in the project and recovery requires manually re-enabling billing.
