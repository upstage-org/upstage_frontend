# Vue 3 + Typescript + Vite

This template should help get you started developing with Vue 3 and Typescript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=johnsoncodehk.volar)

## Type Support For `.vue` Imports in TS

Since TypeScript cannot handle type information for `.vue` imports, they are shimmed to be a generic Vue component type by default. In most cases this is fine if you don't really care about component prop types outside of templates. However, if you wish to get actual prop types in `.vue` imports (for example to get props validation when using manual `h(...)` calls), you can enable Volar's `.vue` type support plugin by running `Volar: Switch TS Plugin on/off` from VSCode command palette.


## Setup and Startup Instructions

To generate the necessary environment scripts and start up the application using Docker, follow these steps:

1. Open your terminal and navigate to the project root directory.

2. Run the following command to generate the environment scripts:
    ```
    ./initial_scripts/generate_environments_script.sh
    ```

3. Once the scripts are generated, start up the application using Docker Compose:
    ```
    docker compose up
    ```

4. The application should now be running. You can access it by navigating to `http://{YOUR_DOMAIN}` in your web browser.

Make sure you have Docker and Docker Compose installed on your machine before running these commands.
