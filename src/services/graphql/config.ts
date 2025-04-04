// @ts-nocheck
import { gql } from "graphql-request";
import { studioClient } from "../graphql";

export default {
  configs: () =>
    studioClient.request(gql`
      query {
        nginx {
            limit
        }
        system {
            termsOfService {
                id
                name
                value
                createdOn
            }
            manual {
                id
                name
                value
                createdOn
            }
            esp {
                id
                name
                value
                createdOn
            }
            enableDonate {
                id
                name
                value
                createdOn
            }
            emailSignature {
                id
                name
                value
                createdOn
            }
            addingEmailSignature {
                id
                name
                value
                createdOn
            }
        }
        foyer {
            title {
                id
                name
                value
                createdOn
            }
            description {
                id
                name
                value
                createdOn
            }
            menu {
                id
                name
                value
                createdOn
            }
            showRegistration {
                id
                name
                value
                createdOn
            }
        }
      }
    `),
  updateTermsOfService: (variables) =>
    studioClient.request(
      gql`
        mutation UpdateTermsOfService($url: String!) {
          updateTermsOfService(url: $url) {
            url
          }
        }
      `,
      variables,
    ),
  saveConfig: (name, value) =>
    studioClient.request(
      gql`
        mutation SaveConfig($name: String!, $value: String!, $enabled: Boolean) {
          saveConfig(input: {
          name: $name
          value: $value
          enabled: $enabled
        }) {
            id
            name
            value
          }
        }
      `,
      { name, value: String(value), ...typeof value == "boolean" ? { enabled: value } : {} },
    ),
  sendEmail: (variables) =>
    studioClient.request(
      gql`
        mutation SendEmail(
          $subject: String!
          $body: String!
          $recipients: String!
          $bcc: String
        ) {
          sendEmail(input:{
            subject: $subject
            body: $body
            recipients: $recipients
            bcc: $bcc
          }) {
            success
          }
        }
      `,
      variables,
    ),
};
