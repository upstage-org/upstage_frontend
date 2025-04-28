// @ts-nocheck
import { gql } from "graphql-request";
import { createClient } from "./graphql";
import { studioClient } from '../graphql';

export default {
  oneTimePurchase: (input) =>
    studioClient.request(gql`
    mutation{
      oneTimePurchase(
        input: {
          cardNumber: "${input.cardNumber}",
          expYear: "20${input.expYear}",
          expMonth: "${input.expMonth}",
          cvc: "${input.cvc}",
          amount:${input.amount}
        })
      {      
        success 
      }
    }`),
  paymentSecret: (input) =>
    studioClient.request(gql`
      mutation{
        paymentSecret(
          input: {
            amount:${input.amount}
          })
      }`),
  generateReceipt: (input) =>
    studioClient.request(gql`
      mutation{
        generateReceipt(receivedFrom: "${input.receivedFrom}", description: "${input.description}" , amount: "${input.amount}",  date: "${input.date}") {
          fileBase64
          fileName
        }
      }`),
};
