
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

Check /set these variables in /frontend_app/.env :
```
# payment
VITE_STRIPE_KEY=""
# release version
VITE_RELEASE_VERSION=""
VITE_ALIAS_RELEASE_VERSION=""
```

Advanced clients may want to edit their email templates. These can be found here:
```
src/mails/templates/templates.py
```

Note that for clients using our email services, we want our email addresses in the SUPPORT_EMAILS list in the back end config file, so that we can get CC-ed on all emails. If the client chooses to use their own email service instead of ours, we can remove ourselves from this list, and not receive CCs. If it's ours, we monitor it, and if it's theirs, we don't.

Only internal to UpStage: 

In ```upstage_backend/app_containers/docker-compose.yaml``` UpStage has to run a fourth container
in the app machine. This fourth container generates email tokens for approved clients who
can send email through our system: 
```
  # For UpStage internal use only.
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


# Data Restoration Guide for Upstage Application

**Date**: May 26, 2025

## Introduction
This guide provides step-by-step instructions for backing up and restoring the database and assets for the Upstage application. Follow the steps carefully to ensure a successful restoration process. All commands are executed in a terminal unless otherwise specified.

## 1. Backup Data from the Source Server

1. **View Configuration File**  
   Inspect the application configuration file to verify settings.  
   ```bash
   cat /home/upstage/upstage/config/app1.py
   ```

2. **Backup the Database**  
   Export the database to a SQL file using `pg_dump`. Ensure the environment variables `$USERNAME`, `$DB_NAME`, and `$HOST` are set.  
   ```bash
   pg_dump -U $USERNAME -d $DB_NAME -h $HOST > upstage.sql
   ```

3. **Zip Assets**  
   Navigate to the uploads directory and create a zip archive of the assets.  
   ```bash
   cd /home/upstage/upstage/uploads
   zip -r ~/assets.zip assets
   ```

## 2. Copy Backup Files to Local Machine

1. **Transfer Database Backup**  
   Copy the database SQL file from the source server to your local machine.  
   ```bash
   scp root@upstage.live:/root/upstage.sql .
   ```

2. **Transfer Assets Archive**  
   Copy the assets zip file from the source server to your local machine.  
   ```bash
   scp root@upstage.live:/root/assets.zip .
   ```

## 3. Copy Backup Files to New Server

1. **Create Directory on New Server**  
   SSH into the new server and create a directory to store the backup files.  
   ```bash
   ssh root@upstage.live
   mkdir ~/databases
   ```

2. **Transfer Files from Local Machine**  
   From your local machine, copy the backup files to the new server’s databases directory.  
   ```bash
   scp upstage.sql root@upstage.live:/root/databases
   scp assets.zip root@upstage.live:/root/databases
   ```

## 4. Restore Database on New Server

1. **View Environment Configuration**  
   Open a new shell on the new server and inspect the environment configuration file.  
   ```bash
   cat /app_code/src/global_config/load_env.py
   ```

2. **Run Database Migration Script**  
   Navigate to the migration scripts directory and execute the database restoration script.  
   ```bash
   cd upstage_backend/migration_scripts
   chmod +x ./run_data_migration.sh && ./run_data_migration.sh
   ```

## 5. Restore Assets on New Server

1. **Run Asset Restoration Script**  
   In the same migration scripts directory, execute the asset restoration script.  
   ```bash
   cd upstage_backend/migration_scripts
   chmod +x ./run_restore_assets.sh && ./run_restore_assets.sh
   ```

## Notes
- Ensure all environment variables (`$USERNAME`, `$DB_NAME`, `$HOST`) are properly set before running commands.
- Verify that you have the necessary permissions to access files and execute scripts.
- Check the integrity of the transferred files (`upstage.sql` and `assets.zip`) before restoration.
- If any issues arise, consult the application documentation or contact the system administrator.

**End of Guide**

