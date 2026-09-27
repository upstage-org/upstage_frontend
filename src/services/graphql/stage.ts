import { gql } from "@apollo/client/core";
import { deriveActiveRecording } from "@utils/stageRecording";
import { studioClient } from "../graphql";

export const stageFragment = gql`
  fragment stageFragment on Stage {
    id
    name
    fileLocation
    status
    visibility
    cover
    description
    playerAccess
    permission
    lastAccess
    attributes {
      id
      name
      description
    }
    owner {
      id
      username
      displayName
    }
    assets {
      id
      name
      assetType {
        name
      }
      src
      description
      fileLocation
      exitAnimation
      exitSpeed
    }
  }
`;

export const assetFragment = gql`
  fragment assetFragment on Asset {
    id
    name
    src
    sign
    createdOn
    size
    description
    assetType {
      id
      name
    }
    owner {
      id
      username
      displayName
    }
    copyrightLevel
    dormant
    permissions {
      id
      userId
      assetId
      approved
      note
      user {
        username
      }
    }
  }
`;

export const sceneFragment = gql`
  fragment sceneFragment on Scene {
    id
    name
    payload
    scenePreview
  }
`;

const stageOps = {
  createStage: async (variables: Record<string, any>) => {
    let result = await studioClient.request<any, Record<string, any>>(
      gql`
        mutation CreateStage(
          $name: String
          $fileLocation: String
          $status: String
          $owner: ID
          $playerAccess: String
        ) {
          createStage(
            input: {
              name: $name
              fileLocation: $fileLocation
              status: $status
              owner: $owner
              playerAccess: $playerAccess
            }
          ) {
            id
          }
        }
      `,
      variables,
    );
    if (result) {
      variables.id = result.createStage.id;
      result = await stageOps.updateStage(variables);
      return result.updateStage;
    }
  },
  updateStage: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation UpdateStage(
          $id: ID!
          $name: String
          $description: String
          $fileLocation: String
          $status: String
          $visibility: Boolean
          $cover: String
          $playerAccess: String
          $owner: ID
        ) {
          updateStage(
            input: {
              id: $id
              name: $name
              description: $description
              fileLocation: $fileLocation
              status: $status
              visibility: $visibility
              cover: $cover
              playerAccess: $playerAccess
              owner: $owner
            }
          ) {
            ...stageFragment
          }
        }
        ${stageFragment}
      `,
      variables,
    ),
  updateStatus: (stageId: string | number) =>
    studioClient.request(gql`
  mutation {
    updateStatus(id: "${stageId}" ) {
      result
    }
  }
  `),
  updateVisibility: (stageId: string | number) =>
    studioClient.request(gql`
  mutation {
    updateVisibility(id: "${stageId}" ) {
      result
    }
  }
  `),
  updateLastAccess: (stageId: string | number) =>
    studioClient.request(gql`
  mutation {
    updateLastAccess(id: "${stageId}" ) {
      result
    }
  }
  `),
  sweepStage: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation SweepStage($id: ID!) {
          sweepStage(id: $id) {
            success
            performanceId
          }
        }
      `,
      variables,
    ),
  stageList: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        query StageTable($page: Int, $limit: Int) {
          stages(input: { page: $page, limit: $limit }) {
            totalCount
            edges {
              ...stageFragment
            }
          }
        }
        ${stageFragment}
      `,
      variables,
    ),
  getStage: (id: string | number) =>
    studioClient.request(
      gql`
        query stage($id: ID!) {
          stage(id: $id) {
            ...stageFragment
            # Broker login for the Stage Management panels (Clear Chat,
            # Customisation, Sweep Stage). Rides this existing request, so
            # those actions cost no extra round trip.
            mqtt {
              username
              password
            }
            chats {
              payload
              performanceId
            }
            performances {
              id
              createdOn
              name
              description
              recording
            }
            scenes {
              id
              name
              scenePreview
              createdOn
              owner {
                id
                username
                displayName
              }
            }
          }
        }
        ${stageFragment}
      `,
      { id },
    ),
  loadStage: (fileLocation: string, performanceId?: string | number | null) =>
    studioClient
      .request<any, Record<string, any>>(
        gql`
          query ListStage($fileLocation: String, $performanceId: ID) {
            stageList(input: { fileLocation: $fileLocation, performanceId: $performanceId }) {
              ...stageFragment
              # Broker login, served at runtime instead of being compiled into
              # the bundle. This query already gates mqtt.connect() (both stage
              # layouts await it), so carrying the credential here adds no
              # request and no latency.
              mqtt {
                username
                password
              }
              permission
              performances {
                id
                name
                createdOn
                recording
              }
              scenes {
                ...sceneFragment
              }
              events {
                id
                topic
                payload
                mqttTimestamp
                performanceId
              }
              chats {
                payload
                performanceId
              }
            }
          }
          ${stageFragment}
          ${sceneFragment}
        `,
        { fileLocation, performanceId },
      )
      .then((response) => ({
        // No matching stage must yield null, not a stub object: callers gate on
        // truthiness before using stage.id (e.g. updateLastAccess).
        stage: response.stageList[0] ? deriveActiveRecording(response.stageList[0]) : null,
      })),
  loadPermission: (fileLocation: string) =>
    studioClient
      .request<any, Record<string, any>>(
        gql`
          query ListStage($fileLocation: String) {
            stageList(input: { fileLocation: $fileLocation }) {
              permission
            }
          }
        `,
        { fileLocation },
      )
      .then((response) => response.stageList[0]?.permission),
  loadScenes: (fileLocation: string) =>
    studioClient
      .request<any, Record<string, any>>(
        gql`
          query ListStage($fileLocation: String) {
            stageList(input: { fileLocation: $fileLocation }) {
              scenes {
                ...sceneFragment
              }
            }
          }
          ${sceneFragment}
        `,
        { fileLocation },
      )
      .then((response) => response.stageList[0]?.scenes),
  loadEvents: (fileLocation: string, cursor?: string | number | null) =>
    studioClient
      .request<any, Record<string, any>>(
        gql`
          query ListStage($fileLocation: String, $cursor: Int) {
            stageList(input: { fileLocation: $fileLocation, cursor: $cursor }) {
              events {
                id
                topic
                payload
                mqttTimestamp
              }
            }
          }
        `,
        { fileLocation, ...(cursor ? { cursor: parseInt(cursor as string) } : {}) },
      )
      .then((response) => response.stageList[0]?.events),
  uploadMedia: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation uploadMedia(
          $name: String!
          $base64: String!
          $mediaType: String!
          $filename: String!
        ) {
          uploadMedia(
            input: { name: $name, base64: $base64, mediaType: $mediaType, filename: $filename }
          ) {
            ...assetFragment
          }
        }
        ${assetFragment}
      `,
      variables,
    ),
  mediaList: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        query MediaList($nameLike: String, $mediaType: String) {
          mediaList(owner: $nameLike, mediaType: $mediaType) {
            ...assetFragment
            id
            name
            createdOn
            size
            description
            fileLocation
            dormant
            assetType {
              name
            }
            copyrightLevel
            tags
            stages {
              id
              name
              fileLocation
              exitAnimation
              exitSpeed
            }
            privilege
          }
        }
        ${assetFragment}
      `,
      variables,
    ),
  mediaTypeList: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        query MediaTypeList {
          mediaTypes {
            id
            name
          }
        }
      `,
      variables,
    ),
  saveStageMedia: (id: string | number, mediaIds: Array<string | number>) =>
    studioClient.request(
      gql`
        mutation assignMedia($id: ID!, $mediaIds: [ID]) {
          assignMedia(input: { id: $id, mediaIds: $mediaIds }) {
            ...stageFragment
          }
        }
        ${stageFragment}
      `,
      { id, mediaIds },
    ),
  assignStages: (id: string | number, stageIds: Array<string | number>) =>
    studioClient.request(
      gql`
        mutation AssignStages($id: ID!, $stageIds: [ID!]) {
          assignStages(input: { id: $id, stageIds: $stageIds }) {
            id
          }
        }
      `,
      { id, stageIds },
    ),
  updateStageAssignment: (
    stageId: string | number,
    assetId: string | number,
    exitAnimation?: string | null,
    exitSpeed?: number | null,
  ) =>
    studioClient.request(
      gql`
        mutation UpdateStageAssignment(
          $stageId: ID!
          $assetId: ID!
          $exitAnimation: String
          $exitSpeed: Int
        ) {
          updateStageAssignment(
            stageId: $stageId
            assetId: $assetId
            exitAnimation: $exitAnimation
            exitSpeed: $exitSpeed
          ) {
            id
            stageId
            childAssetId
            exitAnimation
            exitSpeed
          }
        }
      `,
      { stageId, assetId, exitAnimation, exitSpeed },
    ),
  saveStageConfig: (id: string | number, config: string) =>
    studioClient.request(
      gql`
        mutation UpdateStage($id: ID!, $config: String) {
          updateStage(input: { id: $id, config: $config }) {
            ...stageFragment
          }
        }
        ${stageFragment}
      `,
      { id, config },
    ),
  assignableMedia: () =>
    studioClient.request(gql`
      query AssignableMedia {
        avatars: mediaList(mediaType: "avatar") {
          ...assetFragment
        }
        props: mediaList(mediaType: "prop") {
          ...assetFragment
        }
        backdrops: mediaList(mediaType: "backdrop") {
          ...assetFragment
        }
        audios: mediaList(mediaType: "audio") {
          ...assetFragment
        }
        videos: mediaList(mediaType: "video") {
          ...assetFragment
        }
        curtains: mediaList(mediaType: "curtain") {
          ...assetFragment
        }
      }
      ${assetFragment}
    `),
  updateMedia: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation updateMedia(
          $id: ID!
          $name: String!
          $mediaType: String
          $description: String
          $fileLocation: String
          $base64: String
          $copyrightLevel: Int
          $playerAccess: String
          $uploadedFrames: [String]
        ) {
          updateMedia(
            input: {
              id: $id
              name: $name
              mediaType: $mediaType
              description: $description
              fileLocation: $fileLocation
              base64: $base64
              copyrightLevel: $copyrightLevel
              playerAccess: $playerAccess
              uploadedFrames: $uploadedFrames
            }
          ) {
            id
          }
        }
      `,
      variables,
    ),
  deleteMedia: (id: string | number) =>
    studioClient.request(
      gql`
        mutation deleteMedia($id: ID!) {
          deleteMedia(id: $id) {
            success
            message
          }
        }
      `,
      { id },
    ),
  deleteStage: (id: string | number) =>
    studioClient.request(
      gql`
        mutation deleteStage($id: ID!) {
          deleteStage(id: $id) {
            success
          }
        }
      `,
      { id },
    ),
  saveScene: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation SaveScene($stageId: ID, $payload: String, $preview: String, $name: String) {
          saveScene(
            input: { stageId: $stageId, payload: $payload, preview: $preview, name: $name }
          ) {
            id
          }
        }
      `,
      variables,
    ),
  deleteScene: (id: string | number) =>
    studioClient.request(
      gql`
        mutation DeleteScene($id: ID!) {
          deleteScene(id: $id) {
            success
            message
          }
        }
      `,
      { id },
    ),
  duplicateStage: ({ id, name }: { id: string | number; name: string }) =>
    studioClient.request(
      gql`
        mutation duplicateStage($id: ID!, $name: String!) {
          duplicateStage(id: $id, name: $name) {
            id
            name
            description
          }
        }
      `,
      { id, name },
    ),
  deletePerformance: (id: string | number) =>
    studioClient.request(
      gql`
        mutation DeletePerformance($id: ID!) {
          deletePerformance(id: $id) {
            success
            message
          }
        }
      `,
      { id: String(id) },
    ),
  updatePerformance: (id: string | number, name: string, description?: string | null) =>
    studioClient.request(
      gql`
        mutation updatePerformance($id: ID!, $name: String!, $description: String) {
          updatePerformance(input: { id: $id, name: $name, description: $description }) {
            success
          }
        }
      `,
      { id, name, description },
    ),
  duplicatePerformanceWithTrimmedPauses: (variables: Record<string, any>) =>
    studioClient.request(
      gql`
        mutation DuplicatePerformanceWithTrimmedPauses($input: DuplicatePerformanceTrimInput!) {
          duplicatePerformanceWithTrimmedPauses(input: $input) {
            id
            name
          }
        }
      `,
      variables,
    ),
  startRecording: (stageId: string | number, name: string, description?: string | null) =>
    studioClient.request(
      gql`
        mutation startRecording($input: RecordInput!) {
          startRecording(input: $input) {
            id
            name
            createdOn
            recording
          }
        }
      `,
      { input: { stageId: String(stageId), name, description } },
    ),
  saveRecording: (id: string | number) =>
    studioClient.request(
      gql`
        mutation saveRecording($id: ID!) {
          saveRecording(id: $id) {
            id
            name
            recording
          }
        }
      `,
      { id: String(id) },
    ),
  getSearchOption: () =>
    studioClient.request(gql`
      {
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
    `),
  // Every stage with its access lists, for the player-profile "Stage access"
  // panel. The backend filters the search by the CALLER's permission, so we
  // pass all four levels to disable that filter — the viewer needs to see
  // stages they themselves can only enter as audience.
  stageAccessOverview: () =>
    studioClient.request(
      gql`
        query StageAccessOverview($limit: Int, $access: [String]) {
          stages(input: { limit: $limit, access: $access }) {
            edges {
              id
              name
              fileLocation
              owner {
                id
              }
              playerAccess
            }
          }
        }
      `,
      { limit: 100000, access: ["owner", "editor", "player", "audience"] },
    ),
};

export default stageOps;
