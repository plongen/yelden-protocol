# ⛽ Yelden — Otimizações de Gas

## Resultados Atuais

| Operação | Gas (médio) | Custo estimado (20 gwei) |
|:---|:---|:---|
| Approve | ~45.000 | $0.27 |
| First deposit | ~130.000 | $0.78 |
| Subsequent deposit | ~85.000 | $0.51 |
| Partial withdrawal | ~75.000 | $0.45 |
| Full withdrawal | ~80.000 | $0.48 |
| Transfer | ~65.000 | $0.39 |
| TransferFrom | ~70.000 | $0.42 |
| Harvest | ~85.000 | $0.51 |

## Otimizações Implementadas

✅ **ERC-4626 padrão**: Uso de implementações otimizadas do OpenZeppelin  
✅ **Cálculos em BPS**: Evita divisões desnecessárias  
✅ **Variáveis imutáveis**: `asset` como immutable  
✅ **Events estratégicos**: Apenas eventos essenciais  
✅ **Requires no início**: Early revert para economizar gas  

## Próximas Otimizações Possíveis

- [ ] Usar `unchecked` em loops onde overflow é impossível  
- [ ] Agrupar múltiplas operações de leitura em uma  
- [ ] Usar `calldata` em vez de `memory` em funções externas  