import { gql } from "@apollo/client/core";

export const permissionFragment = gql`
  fragment permissionFragment on Permission {
    id
    userId
    assetId
    approved
    seen
    createdOn
    note
    user {
      username
      displayName
    }
  }
`;

export const adminPlayerFragment = gql`
  fragment adminPlayerFragment on AdminPlayer {
    id
    username
    firstName
    lastName
    displayName
    email
    active
    createdOn
    role
    uploadLimit
    intro
    roleName
  }
`;
