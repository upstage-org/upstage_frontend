
Check /set these variables in /app_code/src/global_config/load_env.py :
```
# All settings in this grouping are only for the upstage.live server: 
# payment
STRIPE_KEY = ""
STRIPE_PRODUCT_ID = ""

# This is the upstage.live host/hosts that will act as an email proxy 
# for servers specified below. 
ACCEPT_EMAIL_HOST = ["upstage.live"]
# These are the domain names of machines from which upstage.live will accept
# and send external email. We act as a mail proxy for approved clients.
ACCEPT_SERVER_SEND_EMAIL_EXTERNAL = []

# This is a list of people who get CC-ed when any email is sent, directly or by proxy:
SUPPORT_EMAILS = ['email_addr1','email_addr2',...]
```

Advanced clients may want to edit their email templates. These can be found here:
```
src/mails/templates/templates.py
```

Note that for clients using our email services, we want our email addresses in the SUPPORT_EMAILS list in the back end config file, so that we can get CC-ed on all emails. If the client chooses to use their own email service instead of ours, we can remove ourselves from this list, and not receive CCs. If it's ours, we monitor it, and if it's theirs, we don't.

Only internal to Upstage: 

In ```upstage_backend/app_containers/docker-compose.yaml``` Upstage has to run a fourth container
in the app machine. This fourth container generates email tokens for approved clients who
can send email through our system: 
```
  # For Upstage internal use only.
  #upstage_emails:
```
Uncomment these lines and
run ```cd upstage_backend/app_containers && ./run_docker_compose.sh```



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


