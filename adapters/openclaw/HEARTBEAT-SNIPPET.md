# → paste into the workspace HEARTBEAT.md

## Throughline reflection（每次心跳检查,低频触发）
# 1. scripts/throughline.sh bootstrap → 看 reflection.due;不 due 就跳过,不要无意义重写。
# 2. due 时:scripts/throughline.sh reflect → 拿到 raw(日记等原料)+ existing(已有立场/规则)+ guidance。
#    把 raw 蒸馏成少量持久记忆(stances / observations / callbacks),每条必须引用原料事件 id 作 evidence;
#    与 existing 矛盾的不要静默选边——下次与用户对话时让他分类(改主意 supersede / 都对 tension / 先放着)。
# 3. 经 scripts/throughline.sh propose '<json>' 提交(行为塑造类会 stage,等用户确认);
#    然后 scripts/throughline.sh reflect-done <cursor> 推进水位线。
# ⚠ DEGRADED(弱模型)时跳过本步——低保真模型不得蒸馏人格层;云端 heartbeat 会兜底。
