{{- define "guest-wall.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "guest-wall.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "guest-wall.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "guest-wall.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "guest-wall.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "guest-wall.selectorLabels" -}}
app.kubernetes.io/name: {{ include "guest-wall.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "guest-wall.pvcName" -}}
{{- default (include "guest-wall.fullname" .) .Values.persistence.existingClaim }}
{{- end }}

{{- define "guest-wall.image" -}}
{{- if .Values.image.digest -}}
{{ printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else -}}
{{ printf "%s:%s" .Values.image.repository .Values.image.tag }}
{{- end -}}
{{- end }}
