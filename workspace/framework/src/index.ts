/**
 * @reui/framework 包入口（RFC-004）。
 *
 * 导出主题系统、组件、Hooks、工具函数。
 */

// 样式（构建时提取为 dist/style.css，消费方通过 @reui/framework/style.css 引入）
import './styles/index.scss';

// 主题系统
export * from './theme';

// antd 封装层组件
export { Input } from './components/antd/Input';
export { Select } from './components/antd/Select';
export { Checkbox } from './components/antd/Checkbox';
export { Radio } from './components/antd/Radio';
export { Slider } from './components/antd/Slider';
export { NumberInput } from './components/antd/NumberInput';
export { ProgressBar } from './components/antd/ProgressBar';
export { Loading } from './components/antd/Loading';
export { Upload } from './components/antd/Upload';
export { List } from './components/antd/List';
export { ContextMenu } from './components/antd/ContextMenu';

// 自研容器/布局组件
export { Panel } from './components/layout/Panel';
export { Stack } from './components/layout/Stack';
export { StatBar } from './components/layout/StatBar';

// 反馈类组件（命令式 API）
export { toast, ToastHost } from './stores/toast';
export { dialog, DialogHost } from './stores/dialog';

// Hooks（@reui/core 集成）
export { useNuiEvent } from './hooks/useNuiEvent';
export { useNuiState } from './hooks/useNuiState';
export { useEvent } from './hooks/useEvent';
export { usePermission } from './hooks/usePermission';
export { useUser } from './hooks/useUser';
export { useVisibility } from './hooks/useVisibility';
export { useInterval } from './hooks/useInterval';

// 状态管理
export { useSharedState } from './stores/shared-state';
export { usePersistentState } from './stores/persistent-state';
export { useTaskManager, useTasks } from './stores/task-manager';

// 工具函数
export { classNames } from './utils/classNames';
export { clamp } from './utils/clamp';
export { createId } from './utils/createId';
