import { gql } from "@apollo/client/core";

/** Toolbar + filters on /media — refetch after saves so tag lists stay in sync site-wide. */
export const MEDIA_PAGE_TOOLBAR_QUERY = gql`
  query MediaPageToolbar {
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

/** Modal metadata for media types + tags — paired with toolbar refetch after saves. */
export const MEDIA_FORM_META_QUERY = gql`
  query MediaFormMeta {
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
