#!/bin/bash
# Fix ArbitrageEngine BigInt/BigNumber issues

# 1. Fix config BigInt values to number
sed -i "s/minProfitThreshold: BigInt('100')/minProfitThreshold: 100/" ArbitrageEngine.ts
sed -i "s/maxCapitalPerTrade: BigInt('1000000')/maxCapitalPerTrade: 1000000/" ArbitrageEngine.ts

# 2. Fix profitEstimate calculations (remove BigInt wrapper, use regular math)
sed -i "s/const profitEstimate = BigInt(Math.floor(optimalSize \* netProfit));/const profitEstimate = optimalSize * netProfit;/" ArbitrageEngine.ts

# 3. Fix requiredCapital (remove BigInt wrapper)
sed -i "s/requiredCapital: BigInt(Math.floor(optimalSize))/requiredCapital: optimalSize/" ArbitrageEngine.ts
sed -i "s/requiredCapital: BigInt(Math.floor(positionSize))/requiredCapital: positionSize/" ArbitrageEngine.ts

# 4. Fix broken ./(syntax
sed -i "s/\.\/(/\/ /" ArbitrageEngine.ts

# 5. Fix BigNumber method calls
sed -i "s/\.mul(95)\./(100)/ * 0.95/" ArbitrageEngine.ts
sed -i "s/\.mul(98)\./(100)/ * 0.98/" ArbitrageEngine.ts
sed -i "s/\.mul(90)\./(100)/ * 0.90/" ArbitrageEngine.ts
sed -i "s/\.add(opportunity\.profitEstimate)/ + opportunity.profitEstimate/" ArbitrageEngine.ts

# 6. Fix .sub() method
sed -i "s/baseArb\.profitEstimate\.sub(bridgeCost\.total)/Number(baseArb.profitEstimate) - Number(bridgeCost.total)/" ArbitrageEngine.ts

# 7. Fix .lte() method  
sed -i "s/adjustedProfit\.lte(this\.config\.minProfitThreshold)/adjustedProfit <= this.config.minProfitThreshold/" ArbitrageEngine.ts

# 8. Fix route.totalProfit.sub()
sed -i "s/route\.totalProfit\.sub(route\.totalGas)/route.totalProfit - Number(route.totalGas)/" ArbitrageEngine.ts

# 9. Fix BigInt threshold comparison
sed -i "s/BigInt('1000000')/1000000/" ArbitrageEngine.ts

# 10. Fix estimateGas return type - keep as bigint for gas calculations
# (no change needed, will handle separately)

# 11. Fix BigInt arithmetic in estimateGas
sed -i "s/BigInt(gasPrice)\.mul('1000000000')\.mul('200000')/BigInt(gasPrice) * BigInt('1000000000') * BigInt('200000')/" ArbitrageEngine.ts

# 12. Fix BigInt arithmetic in estimateBridgeCost
sed -i "s/BigInt(baseCost)\.mul('1000000000000000000')/BigInt(baseCost) * BigInt('1000000000000000000')/" ArbitrageEngine.ts
sed -i "s/sourceGas\.add(targetGas)\.add(bridgeFee)/sourceGas + targetGas + bridgeFee/" ArbitrageEngine.ts

echo "Fixed ArbitrageEngine.ts"
