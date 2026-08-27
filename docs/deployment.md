# Deployment

## Docker Compose

The Compose stack includes Guestwall and a mock printer agent:

```bash
docker compose up --build
```

Guestwall is served at `http://localhost:8000`. The `guestwall-data` volume persists the database
and images.

## Helm and Kubernetes

The chart uses `networking.k8s.io/v1` Ingress resources. It can create a same-namespace Traefik
Basic Auth `Middleware` backed by an existing Kubernetes Secret or reference an existing middleware.
It never creates or embeds credentials.

Start with [`deploy/example-values.yaml`](../deploy/example-values.yaml), then provide environment-
specific hosts, the printer-agent address, authentication, and an immutable image digest. Install
or let a GitOps controller reconcile the release:

```bash
helm upgrade --install guest-wall chart/guest-wall \
  --namespace guest-wall --create-namespace \
  --values deploy/example-values.yaml
```

The example values contain placeholders for:

- The image repository and immutable digest.
- A printer-agent URL reachable from the pod.
- LAN and public hostnames.
- Either `admin.basicAuthSecret` or `admin.basicAuthMiddleware` for the LAN Ingress.
- Persistent volume size and storage class.
- The printer-agent CIDR and port used by NetworkPolicy.

Ingress and NetworkPolicy are disabled in the chart defaults. Enabling LAN ingress without exactly
one Basic Auth secret or middleware reference fails template rendering. The example values enable
both ingress and NetworkPolicy with documentation-only hosts and addresses.

## Ingress model

The LAN Ingress provides the guest application and gallery. Admin paths receive a separate,
higher-priority Basic Auth middleware. The public Ingress exposes only the public page, static
assets, health endpoints, and `/api/public/*`.

The backend repeats this boundary using `PUBLIC_HOST`. See
[Architecture](architecture.md#access-boundaries) for the route checks.

## Network policy

When enabled, the chart permits ingress from configured ingress and monitoring namespaces and
limits printer-agent egress to the configured CIDR and port. Replace the documentation address in
the example values before enabling it in a real cluster.
