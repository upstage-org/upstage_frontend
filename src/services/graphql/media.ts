import gql from "graphql-tag";

/**
 * Named queries used for tags dropdowns. Refetched after saveMedia so new tags
 * appear in both the media edit form and the media filter for all users.
 */
export const MEDIA_FORM_OPTIONS_QUERY = gql`
  query MediaFormOptions {
    mediaTypes {
      id
      name
    }
    tags {
      id
      name
    }
  }
`;

export const MEDIA_FILTER_QUERY = gql`
  query MediaFilterData {
    whoami {
      username
      displayName
      roleName
    }
    users(active: true) {
      id
      username
      displayName
    }
    stages(input: {}) {
      edges {
        id
        name
        createdOn
        owner {
          username
          displayName
        }
      }
    }
    getAllStages {
      id
      name
      permission
    }
    tags {
      id
      name
      color
      createdOn
    }
    mediaTypes {
      id
      name
    }
  }
`;
