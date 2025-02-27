#!/bin/bash

echo "Please provide the following environment variables:"
echo "1. The SERVICE domain name for the service machine you set up before: Example:svc.yourdomain.org"
echo "2. JITSI_ENDPOINT: The endpoint for the Jitsi server, WITHOUT the https://."
echo "3. CLOUDFLARE_CAPTCHA_SITEKEY: The site key for Cloudflare CAPTCHA."

declare -a vars=(
  "SERVICE_DOMAIN"
  "JITSI_ENDPOINT"
  "CLOUDFLARE_CAPTCHA_SITEKEY"
)

MQTT_USERNAME=$(grep -oP '(?<=MQTT_USER = ")[^"]*' /app_code/src/global_config/load_env.py)
MQTT_PASSWORD=$(grep -oP '(?<=MQTT_PASSWORD = ")[^"]*' /app_code/src/global_config/load_env.py)

dirpath=`echo /etc/letsencrypt/live/*/fullchain.pem`
dpath="$(dirname $dirpath)"
IFS='/' read -ra parts <<< "$dpath"
DOMAIN=${parts[4]}

output_file="/frontend_app/.env"

if [ ! -d "/frontend_app" ]; then
  mkdir -p /frontend_app/dist
fi

declare -A values
values[MQTT_USERNAME]=$MQTT_USERNAME
values[MQTT_PASSWORD]=$MQTT_PASSWORD
values[DOMAIN]=$DOMAIN

for var in "${vars[@]}"; do
  if [ "$var" == "JITSI_ENDPOINT" ]; then
    read -rp "Enter value for $var (you can leave this blank and fill it in later): " value
  else
    read -rp "Enter value for $var: " value
  fi
  values[$var]=$value
done


if [ ! -f ./initial_scripts/.env.template ]; then
  echo ".env.template file not found!"
  exit 1
fi

cp ./initial_scripts/.env.template "$output_file"

sed -i "s|{{DOMAIN}}|${values[DOMAIN]}|g" "$output_file"
sed -i "s|{{SERVICE_DOMAIN}}|${values[SERVICE_DOMAIN]}|g" "$output_file"
sed -i "s|{{MQTT_USERNAME}}|${values[MQTT_USERNAME]}|g" "$output_file"
sed -i "s|{{MQTT_PASSWORD}}|${values[MQTT_PASSWORD]}|g" "$output_file"
sed -i "s|{{JITSI_ENDPOINT}}|${values[JITSI_ENDPOINT]}|g" "$output_file"
sed -i "s|{{CLOUDFLARE_CAPTCHA_SITEKEY}}|${values[CLOUDFLARE_CAPTCHA_SITEKEY]}|g" "$output_file"

echo ".env file generated successfully!"
