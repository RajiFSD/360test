/**
 * Minimal, dependency-free logistic regression and ridge regression (batch gradient descent).
 * Transparent: weights map 1:1 to named features, so every prediction can be explained.
 */
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const dot = (w, x) => x.reduce((s, xi, i) => s + xi * w[i], 0);

function trainLogistic(X, y, { lr = 0.5, epochs = 1500, l2 = 0.001 } = {}) {
  const n = X.length;
  const d = X[0].length;
  let w = new Array(d).fill(0);
  let b = 0;
  // Start bias at the base rate for faster convergence.
  const pos = y.reduce((s, v) => s + v, 0) / n;
  b = Math.log((pos + 1e-6) / (1 - pos + 1e-6));
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const err = sigmoid(dot(w, X[i]) + b) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { weights: w, bias: b };
}

const predictLogistic = (model, x) => sigmoid(dot(model.weights, x) + model.bias);

function trainRidge(X, y, { lr = 0.1, epochs = 2000, l2 = 0.01 } = {}) {
  const n = X.length;
  const d = X[0].length;
  const w = new Array(d).fill(0);
  let b = y.reduce((s, v) => s + v, 0) / n;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const err = dot(w, X[i]) + b - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { weights: w, bias: b };
}

const predictRidge = (model, x) => dot(model.weights, x) + model.bias;

/** ROC AUC via rank statistic. */
function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let nPos = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k][1] === 1) {
      rankSum += avgRank;
      nPos++;
    }
    i = j;
  }
  const nNeg = pairs.length - nPos;
  if (!nPos || !nNeg) return 0.5;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

module.exports = { sigmoid, trainLogistic, predictLogistic, trainRidge, predictRidge, auc };
