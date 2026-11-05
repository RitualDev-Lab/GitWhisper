import type { CustomSecretPattern, SecretDetector } from "../types.js";
import { AuthorizationHeaderDetector } from "./authorization-header.js";
import { ConnectionStringDetector } from "./connection-string.js";
import { CustomPatternDetector } from "./custom-pattern.js";
import { EnvironmentFileDetector } from "./env-file.js";
import { JwtDetector } from "./jwt.js";
import { KnownFormatDetector } from "./known-format.js";
import { PrivateKeyDetector } from "./private-key.js";
import { ShannonEntropyDetector } from "./shannon-entropy.js";
import { VariableHeuristicDetector } from "./variable-heuristic.js";

export {
  PrivateKeyDetector,
  AuthorizationHeaderDetector,
  KnownFormatDetector,
  JwtDetector,
  ConnectionStringDetector,
  EnvironmentFileDetector,
  VariableHeuristicDetector,
  ShannonEntropyDetector,
  CustomPatternDetector,
};

export function createDefaultDetectors(
  customPatterns: CustomSecretPattern[] = [],
  entropyThreshold = 4.5,
): SecretDetector[] {
  return [
    new PrivateKeyDetector(),
    new AuthorizationHeaderDetector(),
    new KnownFormatDetector(),
    new JwtDetector(),
    new ConnectionStringDetector(),
    new EnvironmentFileDetector(),
    new VariableHeuristicDetector(),
    new ShannonEntropyDetector(entropyThreshold),
    new CustomPatternDetector(customPatterns),
  ];
}
