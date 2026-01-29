# Sample Required Field Error Messages from UpStage Frontend

This document contains extracted mandatory or required field error messages found in the UpStage frontend codebase.

## Error Messages

1. **Username is required**
   - File: `src/views/Register.vue`
   - Context: Registration form validation

2. **Password is required**
   - File: `src/views/Register.vue`
   - Context: Registration form validation
   - Also found in: `src/views/admin/player-management/ChangePassword.vue`

3. **Email is required**
   - File: `src/views/Register.vue`
   - Context: Registration form validation

4. **Introduction is required**
   - File: `src/views/Register.vue`
   - Context: Registration form validation for user introduction field

5. **Stage name is required**
   - File: `src/views/stages/StageManagement/General.vue`
   - Context: Stage creation/management form validation

6. **URL is required**
   - File: `src/views/stages/StageManagement/General.vue`
   - Context: Stage file location validation

7. **Scene name is required!**
   - File: `src/components/stage/SettingPopup/settings/SaveScene.vue`
   - Context: Scene saving validation

8. **Room name is required**
   - File: `src/components/stage/SettingPopup/settings/CreateRoom.vue`
   - Context: Room creation validation

9. **Stream name is required**
   - File: `src/components/stage/SettingPopup/settings/CreateStream.vue`
   - Context: Stream creation validation

## Default Pattern

- **"{label} is required"**
  - File: `src/components/form/Field.vue`
  - Context: Default fallback message when no custom requiredMessage is provided
