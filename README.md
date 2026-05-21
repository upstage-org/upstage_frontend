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

Testing:

pnpm e2e:features

# Default (today's behavior): all three phases headed, no replay headless.

PWHEADLESS=0 pnpm e2e:perform

# Just rehearsal: cast walks the script in rehearsal mode, no audience.

PWHEADLESS=0 pnpm e2e:perform:rehearsal

# Just live: cast performs while audience watches; no rehearsal, no replay.

PWHEADLESS=0 pnpm e2e:perform:live

# Just replay: no cast logins. Audience watches the most recent recording.

# Errors clearly if no Performance exists for the stage yet.

PWHEADLESS=0 pnpm e2e:perform:replay

# Arbitrary combos via the env var:

PWHEADLESS=0 E2E_PHASES=live,replay pnpm e2e:perform # skip rehearsal
PWHEADLESS=0 E2E_PHASES=rehearsal,replay pnpm e2e:perform # rare; replay against latest existing recording

# Smoke beats still works on top of any phase selection:

PWHEADLESS=0 E2E_PHASES=live E2E_BEATS=smoke pnpm e2e:perform

E2E_REPLAY still works as a fallback default when E2E_PHASES is unset.
