#!/bin/bash
# Re-signs a real token with the e2e backend's own key (read from the e2e
# config the container runs with), exp moved into the past: a token the
# server answers with a genuine "Signature has expired".
docker exec -i upstage_backend_e2e /usr/app/.venv/bin/python -c '
import sys, re, jwt, time
src = open("/usr/app/src/upstage_backend/global_config/load_env.py").read()
key = re.search(r"^SECRET_KEY\s*=\s*[\"\x27](.*?)[\"\x27]", src, re.M).group(1)
tok = sys.stdin.read().strip()
alg = jwt.get_unverified_header(tok)["alg"]
p = jwt.decode(tok, key, algorithms=[alg], options={"verify_exp": False})
p["exp"] = int(time.time()) - 3600
print(jwt.encode(p, key, algorithm=alg))
' 2>&1 | tail -1
