import { gql } from "@apollo/client/core";
import { studioClient } from "../graphql";

export interface PaymentSecretInput {
  amount: number;
  token?: string | null;
}

export interface GenerateReceiptInput {
  receivedFrom: string;
  description: string;
  amount: string;
  date: string;
}

// The former one-time donation helper (raw card number / CVC interpolated
// into the query string) was unused and has been removed; donations go
// through Stripe Elements via `paymentSecret`.
export default {
  paymentSecret: (input: PaymentSecretInput) =>
    studioClient.request(
      gql`
        mutation PaymentSecret($amount: Int!, $token: String) {
          paymentSecret(input: { amount: $amount, token: $token })
        }
      `,
      { amount: input.amount, token: input.token ?? null },
    ),
  // Variables, not string interpolation: the donor name is free text.
  generateReceipt: (input: GenerateReceiptInput) =>
    studioClient.request(
      gql`
        mutation GenerateReceipt(
          $receivedFrom: String!
          $description: String!
          $amount: String!
          $date: String!
        ) {
          generateReceipt(
            receivedFrom: $receivedFrom
            description: $description
            amount: $amount
            date: $date
          ) {
            fileBase64
            fileName
          }
        }
      `,
      { ...input },
    ),
};
