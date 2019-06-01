import fabprotos = require("./bundle");
import { protoConversion } from "./IProtoConversion";
import { MSPRole, IConfigPolicy } from "./interfaces";
import camelCaseDeep = require("camelcase-keys-deep");
import _ from "lodash";

/**
 *  @function
 *
 *  Compute delta set for two given common.Config protos.
 *
 *  @param {fabprotos.commom.Config}  original Original common.config block got from orderer
 *  @param {fabprotos.commom.Config}  updated  Updated common.config block got from {convertOrgJsonToConfigGroup}
 *
 *  @returns {Promise<fabprotos.common.ConfigUpdate>} A promise for a {fabprotos.commom.ConfigUpdate} to be sent as a channel update transaction
 */
const computeDeltaSet = (
  original: fabprotos.common.Config,
  updated: fabprotos.common.Config
) =>
  new Promise<fabprotos.common.ConfigUpdate>((resolve, reject) => {
    if (!original.channelGroup) {
      reject(new Error("no channel group included for original config"));
    }

    if (!updated.channelGroup) {
      reject(new Error("no channel group included for updated config"));
    }

    const [readSet, writeSet, groupUpdated] = computeGroupUpdate(
      original.channelGroup as fabprotos.common.IConfigGroup,
      updated.channelGroup as fabprotos.common.IConfigGroup
    );

    if (!groupUpdated) {
      reject(
        new Error("no differences detected between original and updated config")
      );
    }

    resolve(fabprotos.common.ConfigUpdate.create({ readSet, writeSet }));
  });

const computeGroupUpdate = (
  original: fabprotos.common.IConfigGroup,
  updated: fabprotos.common.IConfigGroup
): [fabprotos.common.IConfigGroup, fabprotos.common.IConfigGroup, boolean] => {
  const [
    readSetPolicies,
    writeSetPolicies,
    sameSetPolicies,
    policiesMembersUpdated
  ] = computePoliciesMapUpdate(
    original.policies as protoConversion.IConfigPolicyMap,
    updated.policies as protoConversion.IConfigPolicyMap
  );
  const [
    readSetValues,
    writeSetValues,
    sameSetValues,
    valuesMembersUpdated
  ] = computeValuesMapUpdate(
    original.values as protoConversion.IConfigValueMap,
    updated.values as protoConversion.IConfigValueMap
  );
  const [
    readSetGroups,
    writeSetGroups,
    sameSetGroups,
    groupsMembersUpdated
  ] = computeGroupsMapUpdate(
    original.groups as protoConversion.IConfigGroupMap,
    updated.groups as protoConversion.IConfigGroupMap
  );

  // If the updated group is 'Equal' to the updated group (none of the
  // members nor the mod policy changed)
  if (
    !(
      policiesMembersUpdated ||
      valuesMembersUpdated ||
      groupsMembersUpdated ||
      original.modPolicy != updated.modPolicy
    )
  ) {
    // If there were no modified entries in any of the
    // policies/values/groups maps
    if (
      protoConversion.size(readSetPolicies) === 0 &&
      protoConversion.size(writeSetPolicies) === 0 &&
      protoConversion.size(readSetValues) === 0 &&
      protoConversion.size(writeSetValues) === 0 &&
      protoConversion.size(readSetGroups) === 0 &&
      protoConversion.size(writeSetGroups) === 0
    ) {
      return [
        fabprotos.common.ConfigGroup.create({ version: original.version }),
        fabprotos.common.ConfigGroup.create({ version: original.version }),
        false
      ];
    }

    return [
      fabprotos.common.ConfigGroup.create({
        version: original.version,
        policies: readSetPolicies,
        values: readSetValues,
        groups: readSetGroups
      }),
      fabprotos.common.ConfigGroup.create({
        version: original.version,
        policies: writeSetPolicies,
        values: writeSetValues,
        groups: writeSetGroups
      }),
      true
    ];
  }
  protoConversion.forEach(sameSetPolicies, (samePolicy, k) => {
    const key = k as string;
    readSetPolicies[key] = samePolicy;
    writeSetPolicies[key] = samePolicy;
  });

  protoConversion.forEach(sameSetValues, (sameValue, k) => {
    const key = k as string;
    readSetValues[key] = sameValue;
    writeSetValues[key] = sameValue;
  });

  protoConversion.forEach(sameSetGroups, (sameGroup, k) => {
    const key = k as string;
    readSetGroups[key] = sameGroup;
    writeSetGroups[key] = sameGroup;
  });
  const version = +(original.version as number) + 1;
  return [
    fabprotos.common.ConfigGroup.create({
      version: original.version,
      policies: readSetPolicies,
      values: readSetValues,
      groups: readSetGroups
    }),
    fabprotos.common.ConfigGroup.create({
      version,
      policies: writeSetPolicies,
      values: writeSetValues,
      groups: writeSetGroups,
      modPolicy: updated.modPolicy
    }),
    true
  ];
};

const computePoliciesMapUpdate = (
  original: protoConversion.IConfigPolicyMap,
  updated: protoConversion.IConfigPolicyMap
): [
  { [k: string]: fabprotos.common.IConfigPolicy },
  { [k: string]: fabprotos.common.IConfigPolicy },
  { [k: string]: fabprotos.common.IConfigPolicy },
  boolean
] => {
  const readSet: { [k: string]: fabprotos.common.IConfigPolicy } = {};
  const writeSet: { [k: string]: fabprotos.common.IConfigPolicy } = {};

  // All modified config goes into the read/write sets, but in case the
  // map membership changes, we retain the config which was the same to
  // add to the read/write sets
  const sameSet: { [k: string]: fabprotos.common.IConfigPolicy } = {};
  let updatedMembers = false;
  protoConversion.forEach(original, (originalPolicy, policyName) => {
    const policyNameStr = policyName as string;
    const updatedPolicy = updated[policyNameStr];
    if (!updatedPolicy) {
      updatedMembers = true;
      return;
    }

    const originalValue = Buffer.from(originalPolicy.policy.value, "base64");
    const updatedValue = Buffer.from(
      (updatedPolicy.policy.value as unknown) as string,
      "base64"
    );
    if (
      originalPolicy.modPolicy === updatedPolicy.modPolicy &&
      originalValue.equals(updatedValue)
    ) {
      sameSet[policyNameStr] = fabprotos.common.ConfigPolicy.create({
        version: originalPolicy.version
      });
      return;
    }

    const errMsg = fabprotos.common.Policy.verify(updatedPolicy.policy);
    if (errMsg) throw errMsg;
    const policy = fabprotos.common.Policy.create(updatedPolicy.policy);
    writeSet[policyNameStr] = fabprotos.common.ConfigPolicy.create({
      version: +originalPolicy.version + 1,
      modPolicy: updatedPolicy.modPolicy,
      policy
    });
  });

  protoConversion.forEach(updated, (updatedPolicy, policyName) => {
    const policyNameStr = policyName as string;
    if (original[policyNameStr]) {
      // If the updatedPolicy is in the original set of policies, it was
      // already handled
      return;
    }
    updatedMembers = true;
    writeSet[policyNameStr] = fabprotos.common.ConfigPolicy.create({
      version: 0,
      modPolicy: updatedPolicy.modPolicy,
      policy: updatedPolicy.policy
    });
  });
  return [readSet, writeSet, sameSet, updatedMembers];
};

const computeValuesMapUpdate = (
  original: protoConversion.IConfigValueMap,
  updated: protoConversion.IConfigValueMap
): [
  { [k: string]: fabprotos.common.IConfigValue },
  { [k: string]: fabprotos.common.IConfigValue },
  { [k: string]: fabprotos.common.IConfigValue },
  boolean
] => {
  const readSet: { [k: string]: fabprotos.common.IConfigValue } = {};
  const writeSet: { [k: string]: fabprotos.common.IConfigValue } = {};

  // All modified config goes into the read/write sets, but in case the map
  // membership changes, we retain the config which was the same to add to
  // the read/write sets
  const sameSet: { [k: string]: fabprotos.common.IConfigValue } = {};
  let updatedMembers = false;
  protoConversion.forEach(original, (originalValue, valueName) => {
    const valueNameStr = valueName as string;
    const updatedValue = updated[valueNameStr];
    if (!updatedValue) {
      updatedMembers = true;
      return;
    }
    if (
      originalValue.modPolicy === updatedValue.modPolicy &&
      original.value === updated.value
    ) {
      sameSet[valueNameStr] = fabprotos.common.ConfigValue.create({
        version: originalValue.version
      });
      return;
    }

    writeSet[valueNameStr] = fabprotos.common.ConfigValue.create({
      version: +originalValue.version + 1,
      modPolicy: updatedValue.modPolicy,
      value: updatedValue.value
    });
  });

  protoConversion.forEach(updated, (updatedValue, valueName) => {
    const valueNameStr = valueName as string;
    if (original[valueNameStr]) {
      // If the updatedValue is in the original set of values, it was
      // already handled
      return;
    }
    updatedMembers = true;
    writeSet[valueNameStr] = fabprotos.common.ConfigValue.create({
      version: 0,
      modPolicy: updatedValue.modPolicy,
      value: updatedValue.value
    });
  });

  return [readSet, writeSet, sameSet, updatedMembers];
};

const computeGroupsMapUpdate = (
  original: { [k: string]: fabprotos.common.IConfigGroup },
  updated: { [k: string]: fabprotos.common.IConfigGroup }
): [
  { [k: string]: fabprotos.common.IConfigGroup },
  { [k: string]: fabprotos.common.IConfigGroup },
  { [k: string]: fabprotos.common.IConfigGroup },
  boolean
] => {
  const readSet: { [k: string]: fabprotos.common.IConfigGroup } = {};
  const writeSet: { [k: string]: fabprotos.common.IConfigGroup } = {};

  // All modified config goes into the read/write sets, but in case the
  // map membership changes, we retain the config which was the same to
  // add to the read/write sets
  const sameSet: { [k: string]: fabprotos.common.IConfigGroup } = {};
  let updatedMembers = false;
  protoConversion.forEach(original, (originalGroup, groupName) => {
    const groupNameStr = groupName as string;
    const updatedGroup = updated[groupNameStr];
    if (!updatedGroup) {
      updatedMembers = true;
      return;
    }

    const [groupReadSet, groupWriteSet, groupUpdated] = computeGroupUpdate(
      originalGroup,
      updatedGroup
    );
    if (!groupUpdated) {
      sameSet[groupNameStr] = fabprotos.common.ConfigGroup.create(
        originalGroup
      );
      sameSet[groupNameStr].modPolicy = originalGroup.modPolicy;
      return;
    }

    readSet[groupNameStr] = groupReadSet;
    writeSet[groupNameStr] = groupWriteSet;
  });

  protoConversion.forEach(updated, (updatedGroup, groupName) => {
    const groupNameStr = groupName as string;
    if (original[groupNameStr]) {
      // If the updatedGroup is in the original set of groups, it was
      // already handled
      return;
    }
    updatedMembers = true;
    const [_, groupWriteSet, __] = computeGroupUpdate(
      fabprotos.common.ConfigGroup.create({}),
      updatedGroup
    );

    writeSet[groupNameStr] = fabprotos.common.ConfigGroup.create({
      version: 0,
      modPolicy: updatedGroup.modPolicy,
      policies: groupWriteSet.policies,
      values: groupWriteSet.values,
      groups: groupWriteSet.groups
    });
  });

  return [readSet, writeSet, sameSet, updatedMembers];
};

// SignaturePolicy is a recursive message structure which defines a
// featherweight DSL for describing
// policies which are more complicated than 'exactly this signature'.  The
// NOutOf operator is sufficent to express AND as well as OR, as well as of
// course N out of the following M policies SignedBy implies that the signature
// is from a valid certificate which is signed by the trusted authority
// specified in the bytes.  This will be the certificate itself for a
// self-signed certificate and will be the CA for more traditional certificates
const createRuleRecursively = (
  rule: any
): fabprotos.common.SignaturePolicy | fabprotos.common.SignaturePolicy[] => {
  let newRule = fabprotos.common.SignaturePolicy.create(rule);
  Object.keys(newRule).forEach(key => {
    if (key === "nOutOf") {
      const nOutOf = newRule.nOutOf as fabprotos.common.SignaturePolicy.INOutOf;
      nOutOf.rules = createRuleRecursively(
        rule[key]
      ) as fabprotos.common.SignaturePolicy[];
    }
    if (key === "rules" && rule[key] instanceof Array) {
      newRule = rule[key].map((elem: fabprotos.common.SignaturePolicy) =>
        createRuleRecursively(elem)
      );
    }
  });
  return newRule;
};

/**
 * @function
 *
 * Converts an OrgJson got from configtxgen into a {fabprotos.common.ConfigGroup}
 * @param {any} orgJson Json generated by printOrg in configtxgen
 * @returns {fabprotos.common.ConfigGroup}
 */
const convertOrgJsonToConfigGroup = (
  orgJson: any
): fabprotos.common.ConfigGroup => {
  const eachRecursive = (obj: any) => {
    // each recursive iterate recursively down to the object changing its
    // necessary keys to proto expected ones
    for (const k in obj) {
      if (k === "version" && typeof obj[k] === "string") {
        obj[k] = parseInt(obj[k]);
      } else if (typeof obj[k] === "object" && k === "values") {
        eachRecursive(obj[k]);
      } else if (k === "msp" && typeof obj[k] === "object") {
        if (obj[k].value.config) {
          obj[k].version = parseInt(obj[k].version);

          const errMsg = fabprotos.msp.FabricMSPConfig.verify(
            obj[k].value.config
          );
          if (errMsg) throw new Error("Invalid MSP config");

          const fabMSPConfig = fabprotos.msp.FabricMSPConfig.create(
            obj[k].value.config
          );
          const mspConfig = fabprotos.msp.MSPConfig.create({
            config: fabprotos.msp.FabricMSPConfig.encode(fabMSPConfig).finish()
          });

          obj[k].value = fabprotos.msp.MSPConfig.encode(mspConfig).finish();
        }

        obj.MSP = fabprotos.common.ConfigValue.create(obj[k]);
        delete obj.msp;
        continue;
      } else if (k === "policy" && typeof obj[k] === "object") {
        const sigPolEnvelope = fabprotos.common.SignaturePolicyEnvelope.create(
          obj[k].value
        );
        sigPolEnvelope.identities = sigPolEnvelope.identities.map(identity => {
          const castedPrincipal = (identity.principal as unknown) as MSPRole;

          const principalEnum = (fabprotos.common.MSPRole.MSPRoleType[
            castedPrincipal.role
          ] as unknown) as fabprotos.common.MSPRole.MSPRoleType;
          console.log(castedPrincipal);
          const principal = fabprotos.common.MSPRole.create({
            mspIdentifier: castedPrincipal.mspIdentifier,
            role: principalEnum
          });

          const errMsg = fabprotos.common.MSPRole.verify(principal);
          if (errMsg)
            throw new Error(
              `Error verifying MSPRole on translate newOrg ${errMsg}`
            );

          const principalBytes = fabprotos.common.MSPRole.encode(
            principal
          ).finish();
          const principalClassificationIndex = identity.principalClassification as fabprotos.common.MSPPrincipal.Classification;
          const principalClassification = (fabprotos.common.MSPPrincipal
            .Classification[
            principalClassificationIndex
          ] as unknown) as fabprotos.common.MSPPrincipal.Classification;

          return fabprotos.common.MSPPrincipal.create({
            principal: principalBytes,
            principalClassification
          });
        });

        sigPolEnvelope.rule = createRuleRecursively(
          sigPolEnvelope.rule
        ) as fabprotos.common.SignaturePolicy;

        const errMsg = fabprotos.common.SignaturePolicyEnvelope.verify(
          sigPolEnvelope
        );
        if (errMsg) throw errMsg;

        const sigPolEnvelopeBytes = fabprotos.common.SignaturePolicyEnvelope.encode(
          sigPolEnvelope
        ).finish();
        const policy = fabprotos.common.Policy.create({
          type: obj[k].type,
          value: sigPolEnvelopeBytes
        });

        obj[k] = policy;
        continue;
      }
      if (typeof obj[k] === "object" && obj[k] !== null) eachRecursive(obj[k]);
    }
  };
  const convertedValueGroup = camelCaseDeep(orgJson.values);
  const desiredFromJSON = _.pick(orgJson, ["groups", "mod_policy", "policies"]);
  const modPolicy = desiredFromJSON.mod_policy;
  delete desiredFromJSON.mod_policy;
  const translated = fabprotos.common.ConfigGroup.create({
    ...desiredFromJSON,
    values: convertedValueGroup,
    modPolicy
  });
  for (const k in translated.policies) {
    let policy = translated.policies[k] as IConfigPolicy;
    policy = camelCaseDeep(policy);
    translated.policies[k] = fabprotos.common.ConfigPolicy.create(policy);
  }
  eachRecursive(translated);
  console.log(translated.policies.Readers);

  const errMsg = fabprotos.common.ConfigGroup.verify(translated);
  if (errMsg)
    throw new Error(
      `Could not convert new OrgJson failed with error ${errMsg}`
    );
  return translated;
};

module.exports.computeDeltaSet = computeDeltaSet;
module.exports.convertOrgJsonToConfigGroup = convertOrgJsonToConfigGroup;
