
Check /set these variables in /app_code/src/global_config/load_env.py :
```
# These settings are only for the upstage.live server. 
# payment
STRIPE_KEY = ""
STRIPE_PRODUCT_ID = ""

# This is the upstage.live host/hosts that will act as an email proxy 
# for servers specified below. 
ACCEPT_EMAIL_HOST = ["upstage.live"]
# These are the domain names of machines from which upstage.live will accept
# and send external email. We act as a mail proxy for approved clients.
ACCEPT_SERVER_SEND_EMAIL_EXTERNAL = []
```

Change to "Production" for official releases. Not equal to Production means
the front end can be fed from localhost, which is great for debugging.
```
ENV_TYPE="Dev/Testing"
```

CloudFlare is OFF if these variables are commented out:
```
CLOUDFLARE_CAPTCHA_SECRETKEY
CLOUDFLARE_CAPTCHA_VERIFY_ENDPOINT
```


