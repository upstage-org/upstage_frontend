#!/bin/bash

rm -rf /frontend_app/dist

docker compose down
docker compose up -d
