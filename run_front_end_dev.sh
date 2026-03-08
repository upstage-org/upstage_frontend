#!/bin/bash

set -a

build_dir=/frontend_app_dev/build

rm -rf /frontend_app_dev/dist
mkdir /frontend_app_dev/dist

# index.html is kept under initial_scripts/build_files, and is copied up 
# to the topmost directory during the front end build.

cp -r ./initial_scripts/build_files/* $build_dir
cp -r ./src $build_dir
cp -r ./public $build_dir
cp -r ./public/favicon.ico $build_dir
cp -r ./docker-compose-dev.yaml $build_dir

cp  /frontend_app_dev/.env /frontend_app_dev/dist/.env # Cannot mount .env from root dir. Docker copies it out.

cd $build_dir

echo "This build may take up to three minutes. It may be necessary to run 'docker compose rm -f' after the 'docker compose down' command to do a deep cleanup between builds."

echo "Building..."

docker compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev down
docker compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev up -d
docker compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev ps

echo "Done"
