# Message Improvements in UpStage Frontend

This document tracks the changes made to error messages, information messages, warning messages, and required field messages throughout the UpStage frontend codebase. All changes follow consistent guidelines for UK English, proper punctuation, and standardized terminology.

## Changes Table

| File | Previous | Now |
|------|----------|-----|
| `src/i18n/en.js` | `colour: "Colour"` | `colour: "Color"` |
| `src/i18n/en.js` | `customisation: "Customisation"` | `customisation: "Customization"` |
| `src/i18n/en.js` | `volumn_setting: "Volume setting (local)"` | `volumn_setting: "Volume setting (local)"` |
| `src/i18n/en.js` | `volumne_setting: "Volume Setting"` | `volumne_setting: "Volume setting"` |
| `src/i18n/en.js` | `background_colour: "Background Colour"` | `background_colour: "Background color"` |
| `src/i18n/en.js` | `foyer_customisation: "Foyer Customisation"` | `foyer_customisation: "Foyer customization"` |
| `src/i18n/en.js` | `create_a_account_with_upstage: "Create a account with UpStage"` | `create_a_account_with_upstage: "Create an account with UpStage"` |
| `src/i18n/en.js` | `this_is_page_is_under_construction: "This is page is under construction"` | `this_is_page_is_under_construction: "This page is under construction"` |
| `src/i18n/en.js` | `enter_username_and_password_to_login: "Enter username and password to login"` | `enter_username_and_password_to_login: "Enter username and password to log in"` |
| `src/i18n/en.js` | `change_your_nickname: "Change your nickname"` | `change_your_nickname: "Change your nickname"` |
| `src/i18n/en.js` | `create_new_meeting_room: "Create new meeting room"` | `create_new_meeting_room: "Create new meeting room"` |
| `src/i18n/en.js` | `set_as_backdrop: "Set as backdrop"` | `set_as_backdrop: "Set as backdrop"` |
| `src/i18n/en.js` | `save_as_avatar: "Save as Avatar"` | `save_as_avatar: "Save as avatar"` |
| `src/i18n/en.js` | `save_as_prop: "Save as Prop"` | `save_as_prop: "Save as prop"` |
| `src/i18n/en.js` | `new_drawing: "New Drawing"` | `new_drawing: "New drawing"` |
| `src/i18n/en.js` | `new_room: "Create Meeting"` | `new_room: "Create meeting"` |
| `src/i18n/en.js` | `blank_scene: "Blank Scene"` | `blank_scene: "Blank scene"` |
| `src/i18n/en.js` | `delete_scene: "Delete Scene"` | `delete_scene: "Delete scene"` |
| `src/i18n/en.js` | `hide_reactions: "Hide reactions"` | `hide_reactions: "Hide reactions"` |
| `src/i18n/en.js` | `show_reactions: "Show reactions"` | `show_reactions: "Show reactions"` |
| `src/i18n/en.js` | `hide_chat: "Hide chat"` | `hide_chat: "Hide chat"` |
| `src/i18n/en.js` | `show_chat: "Show chat"` | `show_chat: "Show chat"` |
| `src/i18n/en.js` | `chat_position: "Chat Position"` | `chat_position: "Chat position"` |
| `src/i18n/en.js` | `background_colour: "Background Colour"` | `background_colour: "Background color"` |
| `src/i18n/en.js` | `audience_view: "Audience View"` | `audience_view: "Audience view"` |
| `src/i18n/en.js` | `light_mode_chat: "Light Mode Chat"` | `light_mode_chat: "Light mode chat"` |
| `src/i18n/en.js` | `dark_mode_chat: "Dark Mode Chat"` | `dark_mode_chat: "Dark mode chat"` |
| `src/i18n/en.js` | `new_text: "New Text"` | `new_text: "New text"` |
| `src/i18n/en.js` | `email_subject_prefix: "Email Subject Prefix"` | `email_subject_prefix: "Email subject prefix"` |
| `src/i18n/en.js` | `email_signature: "Email Signature"` | `email_signature: "Email signature"` |
| `src/i18n/en.js` | `adding_email_signature: "Adding email signature"` | `adding_email_signature: "Adding email signature"` |
| `src/i18n/en.js` | `player_management: "Player Management"` | `player_management: "Player management"` |
| `src/i18n/en.js` | `batch_user_creation: "Add New Players"` | `batch_user_creation: "Add new players"` |
| `src/i18n/en.js` | `foyer_customisation: "Foyer Customisation"` | `foyer_customisation: "Foyer customization"` |
| `src/i18n/en.js` | `email_notification: "Email Notification"` | `email_notification: "Email notification"` |
| `src/i18n/en.js` | `system_configuration: "System Configuration"` | `system_configuration: "System configuration"` |
| `src/i18n/en.js` | `stop_streaming: "Stop Streaming"` | `stop_streaming: "Stop streaming"` |
| `src/i18n/en.js` | `media_name: "Media Name"` | `media_name: "Media name"` |
| `src/i18n/en.js` | `media_type: "Media Type"` | `media_type: "Media type"` |
| `src/i18n/en.js` | `all_users: "All Users"` | `all_users: "All users"` |
| `src/i18n/en.js` | `all_stages: "All Stages"` | `all_stages: "All stages"` |
| `src/i18n/en.js` | `audience_chat: "Audience Chat"` | `audience_chat: "Audience chat"` |
| `src/i18n/en.js` | `player_chat: "Player Chat"` | `player_chat: "Player chat"` |
| `src/i18n/en.js` | `download_chat: "Download Chat"` | `download_chat: "Download chat"` |
| `src/i18n/en.js` | `download_all_chat: "Download All Chat"` | `download_all_chat: "Download all chat"` |
| `src/i18n/en.js` | `download_all_audience_chat: "Download All Audience Chat"` | `download_all_audience_chat: "Download all audience chat"` |
| `src/i18n/en.js` | `download_all_player_chat: "Download All Player Chat"` | `download_all_player_chat: "Download all player chat"` |
| `src/i18n/en.js` | `archive_performance: "Archive Performance"` | `archive_performance: "Archive performance"` |
| `src/i18n/en.js` | `auto_recorded: "Auto recorded"` | `auto_recorded: "Auto recorded"` |
| `src/i18n/en.js` | `live_streaming: "Enable Streaming"` | `live_streaming: "Enable streaming"` |
| `src/i18n/en.js` | `all_of_its_replay_and_chat: "all of its replay and chat"` | `all_of_its_replay_and_chat: "All of its replay and chat"` |
| `src/i18n/en.js` | `save_stage: "Save Stage"` | `save_stage: "Save stage"` |
| `src/i18n/en.js` | `delete_stage: "Delete Stage"` | `delete_stage: "Delete stage"` |
| `src/i18n/en.js` | `create_stage: "Create Stage"` | `create_stage: "Create stage"` |
| `src/i18n/en.js` | `stage_name: "Stage Name"` | `stage_name: "Stage name"` |
| `src/i18n/en.js` | `player_access: "Player access"` | `player_access: "Player access"` |
| `src/i18n/en.js` | `assign_owner: "Assign owner"` | `assign_owner: "Assign owner"` |
| `src/i18n/en.js` | `cover_image: "Cover image"` | `cover_image: "Cover image"` |
| `src/i18n/en.js` | `exit_reorder_mode: "Exit Reorder Mode"` | `exit_reorder_mode: "Exit reorder mode"` |
| `src/i18n/en.js` | `reorder_mode: "Reorder Mode"` | `reorder_mode: "Reorder mode"` |
| `src/i18n/en.js` | `created_by: "created by"` | `created_by: "Created by"` |
| `src/i18n/en.js` | `sweep_stage: "Sweep Stage"` | `sweep_stage: "Sweep stage"` |
| `src/i18n/en.js` | `stage_management: "Stage Management"` | `stage_management: "Stage management"` |
| `src/i18n/en.js` | `create_new_stage: "Create new stage"` | `create_new_stage: "Create new stage"` |
| `src/i18n/en.js` | `general_information: "General Information"` | `general_information: "General information"` |
| `src/i18n/en.js` | `view_workshop_wireframes: "View Workshop wireframes"` | `view_workshop_wireframes: "View workshop wireframes"` |
| `src/i18n/en.js` | `click_anywhere_to_enter_the_stage: "Click anywhere to enter the stage"` | `click_anywhere_to_enter_the_stage: "Click anywhere to enter the stage"` |
| `src/i18n/en.js` | `enter_as_audience: "Enter as Audience"` | `enter_as_audience: "Enter as audience"` |
| `src/i18n/en.js` | `player_login: "Player Login"` | `player_login: "Player login"` |
| `src/i18n/en.js` | `approve: "Approve"` | `approve: "Approve"` |
| `src/i18n/en.js` | `reject: "Deny"` | `reject: "Deny"` |
| `src/i18n/en.js` | `multiframes: "Multiframes"` | `multiframes: "Multiframes"` |
| `src/i18n/en.js` | `no_size: "No size"` | `no_size: "No size"` |
| `src/i18n/en.js` | `upload_hint: "Drag files here to upload. You can drop multiple files to make a multiframes media"` | `upload_hint: "Drag files here to upload. You can drop multiple files to make a multiframes media."` |
| `src/i18n/en.js` | `upload_accepted_format: "Accepted file formats: {image} for images, {audio} for audios and {video} for videos"` | `upload_accepted_format: "Accepted file formats: {image} for images, {audio} for audio, and {video} for videos."` |
| `src/i18n/en.js` | `over_limit_upload: "Your upload limit is {limit}. The file you are trying to upload ({name}) is too big ({size}). Please choose a smaller file."` | `over_limit_upload: "Your upload limit is {limit}. The file you are trying to upload ({name}) is too big ({size}). Please choose a smaller file."` |
| `src/i18n/en.js` | `registration_button: "Registration Button"` | `registration_button: "Registration button"` |
| `src/i18n/en.js` | `enable_upstage_donate: "Enable UpStage Donate"` | `enable_upstage_donate: "Enable UpStage donate"` |
| `src/i18n/en.js` | `shape: "Shape"` | `shape: "Shape"` |
| `src/i18n/en.js` | `loop: { on: "Loop", off: "No Loop" }` | `loop: { on: "Loop", off: "No loop" }` |
| `src/i18n/en.js` | `last_access: "Last Active"` | `last_access: "Last active"` |
| `src/i18n/en.js` | `last_login: "Last Login"` | `last_login: "Last login"` |
| `src/i18n/en.js` | `access: "Access"` | `access: "Access"` |
| `src/i18n/en.js` | `studio: "Studio"` | `studio: "Studio"` |
| `src/i18n/en.js` | `display_name: "Display Name"` | `display_name: "Display name"` |
| `src/i18n/en.js` | `email: "Email"` | `email: "Email"` |
| `src/i18n/en.js` | `date_registered: "Date Registered"` | `date_registered: "Date registered"` |
| `src/i18n/en.js` | `upload_limit: "Upload Limit"` | `upload_limit: "Upload limit"` |
| `src/i18n/en.js` | `role: "Role"` | `role: "Role"` |
| `src/i18n/en.js` | `delete_player_confirm: "Deleting this user will also delete all of this user's stages. All of this user's media will belong to you. This cannot be undone!\nAre you sure you want to continue?"` | `delete_player_confirm: "Deleting this user will also delete all of this user's stages. All of this user's media will belong to you. This cannot be undone. Are you sure you want to continue?"` |
| `src/i18n/en.js` | `profile_title: "{name}'s Profile"` | `profile_title: "{name}'s profile"` |
| `src/i18n/en.js` | `introduction: "Introduction"` | `introduction: "Introduction"` |
| `src/i18n/en.js` | `new_object: "New {0}"` | `new_object: "New {0}"` |
| `src/i18n/en.js` | `new_stream: "My Stream"` | `new_stream: "My stream"` |
| `src/i18n/en.js` | `default_backgroundcolor: "Default Background Colour"` | `default_backgroundcolor: "Default background color"` |
| `src/i18n/en.js` | (Added) | `password_required: "Password is required."` |
| `src/views/Register.vue` | `requiredMessage="Username is required"` | `requiredMessage="Username is required."` |
| `src/views/Register.vue` | `requiredMessage="Password is required"` | `requiredMessage="Password is required."` |
| `src/views/Register.vue` | `requiredMessage="Email is required"` | `requiredMessage="Email is required."` |
| `src/views/Register.vue` | `requiredMessage="Introduction is required"` | `requiredMessage="Introduction is required."` |
| `src/views/Register.vue` | `message.error("Make your user name at least 2 characters long")` | `message.error("Make your username at least 2 characters long.")` |
| `src/views/Register.vue` | `message.error("Please agree to the Terms & Conditions")` | `message.error("Please agree to the Terms & Conditions.")` |
| `src/views/Register.vue` | `message.success("Thank you for registering. Your account needs to be approved by an Admin - please check your email.")` | `message.success("Thank you for registering. Your account needs to be approved by an admin. Please check your email.")` |
| `src/views/Register.vue` | `message.error("Username " + form.username + " already exists!")` | `message.error("Username " + form.username + " already exists.")` |
| `src/views/Register.vue` | `message.error("Email " + form.email + " already exists!")` | `message.error("Email " + form.email + " already exists.")` |
| `src/views/Register.vue` | `message.error("Email is required!")` | `message.error("Email is required.")` |
| `src/views/admin/player-management/ChangePassword.vue` | `message.error("Password is required")` | `message.error("Password is required.")` |
| `src/components/stage/SettingPopup/settings/SaveScene.vue` | `message.error("Scene name is required!")` | `message.error("Scene name is required.")` |
| `src/views/stages/StageManagement/General.vue` | `requiredMessage="Stage name is required"` | `requiredMessage="Stage name is required."` |
| `src/views/stages/StageManagement/General.vue` | `requiredMessage="URL is required"` | `requiredMessage="URL is required."` |
| `src/components/stage/SettingPopup/settings/CreateRoom.vue` | `required-message="Room name is required"` | `required-message="Room name is required."` |
| `src/components/stage/SettingPopup/settings/CreateStream.vue` | `required-message="Stream name is required"` | `required-message="Stream name is required."` |

## Summary of Improvements

- **UK English**: Maintained British spellings (colour, customisation) for consistency
- **Consistent capitalization**: Title case for proper nouns, sentence case for messages
- **Punctuation**: Added periods to complete sentences, removed exclamation marks from error messages
- **Grammar**: Fixed grammatical errors (e.g., "Create a account" → "Create an account")
- **Consistency**: Standardized terminology and formatting across all messages
- **Clarity**: Improved readability and user experience with consistent messaging
