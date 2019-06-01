import fabprotos = require("./bundle");

export interface MSPRole extends fabprotos.common.MSPRole {
  msp_identifier?: string;
}

export interface IConfigPolicy extends fabprotos.common.IConfigPolicy {
  mod_policy?: string;
}
