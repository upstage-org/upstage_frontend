#!/bin/bash

build_dir=/frontend_app/build

rm -rf /frontend_app/dist

# index.html is kept under initial_scripts/build_files, and is copied up 
# to the topmost directory during the front end build.

cp -r ./initial_scripts/build_files/* $build_dir
cp -r ./src $build_dir
cp -r ./public $build_dir
cp -r ./public/favicon.ico $build_dir
cp -r ./docker-compose.yaml $build_dir

cd $build_dir

echo "This build may take up to three minutes. It may be necessary to run 'docker compose rm -f' after the 'docker compose down' command to do a deep cleanup between builds."

echo "Building..."

docker compose down
docker compose up -d

echo "Done"
