# Guestwall logo

`docs/branding/guestwall-logo.svg` is the original supplied artwork, preserved without modifications.

`frontend/public/favicon.svg` is the optimized web copy used by the homepage header and
browser favicon. It keeps the vector artwork and uses a tighter square viewBox (`212 174 890 890`)
to remove excess transparent margins at small display sizes. Both uses share `/favicon.svg`.

To regenerate the web copy from the repository root:

```bash
python3 - <<'PY'
from pathlib import Path

source = Path("docs/branding/guestwall-logo.svg").read_text()
Path("/tmp/guestwall-logo-web.svg").write_text(
    source.replace('viewBox="0 0 1254 1254"', 'viewBox="212 174 890 890"', 1)
)
PY
npx --yes --package=svgo@4.1.0 svgo --multipass \
  --input /tmp/guestwall-logo-web.svg --output frontend/public/favicon.svg
```
