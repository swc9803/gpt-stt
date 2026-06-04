"use strict";

const {CloudBillingClient} = require("@google-cloud/billing");

const billing = new CloudBillingClient();

function decodeBudgetMessage(event) {
  const encoded =
    event?.data?.message?.data ||
    event?.message?.data ||
    event?.data;

  if (!encoded) {
    throw new Error("Missing Pub/Sub message data");
  }

  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

async function isBillingEnabled(projectName) {
  const [info] = await billing.getProjectBillingInfo({name: projectName});
  return Boolean(info.billingEnabled);
}

async function disableBilling(projectName) {
  const [result] = await billing.updateProjectBillingInfo({
    name: projectName,
    resource: {
      billingAccountName: ""
    }
  });

  return result;
}

exports.stopBilling = async (event) => {
  const targetProjectId = process.env.TARGET_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const projectName = `projects/${targetProjectId}`;
  const budget = decodeBudgetMessage(event);

  const costAmount = Number(budget.costAmount);
  const budgetAmount = Number(budget.budgetAmount);

  console.log("Budget notification received", {
    targetProjectId,
    costAmount,
    budgetAmount,
    currencyCode: budget.currencyCode,
    budgetDisplayName: budget.budgetDisplayName
  });

  if (!Number.isFinite(costAmount) || !Number.isFinite(budgetAmount)) {
    throw new Error("Budget notification did not include numeric costAmount and budgetAmount");
  }

  if (costAmount < budgetAmount) {
    console.log("Budget not reached; leaving billing enabled");
    return;
  }

  if (!(await isBillingEnabled(projectName))) {
    console.log("Billing is already disabled");
    return;
  }

  const result = await disableBilling(projectName);
  console.log("Billing disabled", result);
};
