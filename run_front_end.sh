#!/bin/bash

build_dir=/frontend_app/build

rm -rf /frontend_app/dist

cp -r ./initial_scripts/build_files/* $build_dir
cp -r ./src $build_dir
cp -r ./public $build_dir
cp -r ./docker-compose.yaml $build_dir

cd $build_dir

docker compose down
docker compose up -d
