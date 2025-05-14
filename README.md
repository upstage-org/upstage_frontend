# UpStage Front End Installation 
Do This After Back End Installation and Configuration. See the upstage_backend repo README for details.
https://github.com/upstage-org/upstage_backend

## Setup and Startup Instructions

To generate the necessary environment scripts and start up the application using Docker, follow these steps:

1. Open your terminal and navigate to upstage_frontend

1. Run the following command to generate the environment scripts:
    ```
    ./initial_scripts/generate_environments_script.sh
    ```

1. Once the scripts are generated, start up the application using Docker Compose:
    ```
    ./run_front_end.sh
    ```

1. The application should now be running. You can access it by navigating to `https://{YOUR_DOMAIN}` in your web browser.

