# Deployment

## Docker Compose

The production-shaped local stack includes Guestwall and a mock printer agent:

```bash
docker compose up --build
```

Open `http://localhost:8000`. The `guestwall-data` Docker volume persists the database and images.

## Helm and K3s

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

Operator configuration still required:

1. Publish or select an ARM64-capable image and pin its repository and digest.
2. Set a printer-agent URL reachable from the pod. The browser never receives this URL.
3. Configure LAN DNS and the public hostname.
4. Provide either `admin.basicAuthSecret` or `admin.basicAuthMiddleware` for the LAN Ingress.
5. Keep one replica and choose the appropriate persistent volume size and storage class.
6. Restrict the printer agent to trusted callers at the network or host firewall layer.

The default chart ingresses are disabled so example hostnames cannot be deployed accidentally.
Enabling LAN ingress without exactly one Basic Auth secret or middleware reference fails template
rendering. NetworkPolicy is opt-in because its printer-agent address and port must match the target
environment.

## Ingress model

The LAN Ingress provides the guest application and gallery. Admin paths receive a separate,
higher-priority Basic Auth middleware. The public Ingress exposes only the public page, static
assets, health endpoints, and `/api/public/*`.

The backend repeats this boundary using `PUBLIC_HOST`, so an ingress routing mistake does not make
LAN or admin APIs available through the public hostname. See
[Architecture](architecture.md#access-boundaries) for the complete model.

## Network policy

When enabled, the chart permits ingress from configured ingress and monitoring namespaces and
limits printer-agent egress to the configured CIDR and port. Replace the documentation address in
the example values before enabling it in a real cluster.
