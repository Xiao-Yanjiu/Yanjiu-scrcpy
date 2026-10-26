<template>
  <el-slider
    v-if="data.props?.slider"
    v-bind="$attrs"
    class="appearance-slider"
    :min="data.props.min"
    :max="data.props.max"
    :step="data.props.step"
    :format-tooltip="value => `${value}${data.props.unit || ''}`"
    show-input
    :show-input-controls="false"
    @update:model-value="value => $emit('update:model-value', value)"
  />
  <el-input
    v-else
    class="!w-full"
    v-bind="{
      type: 'number',
      clearable: true,
      ...(data.props || {}),
    }"
    @update:model-value="(val) => $emit('update:model-value', val ? Number(val) : undefined)"
  >
    <template v-if="data.append" #append>
      {{ data.append }}
    </template>
  </el-input>
</template>

<script>
export default {
  props: {
    data: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ['update:model-value'],
}
</script>

<style></style>
