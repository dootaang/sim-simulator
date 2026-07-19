<script lang="ts">
  let{backend}:{backend:string}=$props();
  let label=$derived(backend==='sqlite-opfs'?'고속 브라우저 파일 저장':backend==='indexeddb'?'호환 저장소':backend==='memory'?'임시 메모리':'기기 저장소');
</script>

<fieldset class="recovery">
  <legend>저장·복구 확인</legend>
  <p><span>현재 저장 방식</span><b>{label}</b></p>
  <details>
    <summary>삭제되었을 때 복구 방법</summary>
    <ul>
      <li><b>빠른 이미지 캐시만 삭제:</b> 원본 에셋 모듈에서 자동으로 다시 만듭니다.</li>
      <li><b>에셋 모듈만 삭제:</b> 원본 모듈 파일을 다시 선택하면 기존 세이브를 유지합니다.</li>
      <li><b>사이트 데이터 전체 삭제:</b> 채팅 백업을 가져온 뒤 원본 카드와 에셋 모듈을 다시 선택합니다.</li>
      <li><b>백업과 원본 파일도 없음:</b> 복구할 수 없습니다.</li>
    </ul>
  </details>
  <small>브라우저의 영구 저장 허용도 사용자 삭제까지 막지는 못합니다. 중요한 회차는 채팅 내보내기와 원본 카드·모듈 파일을 함께 보관하세요.</small>
</fieldset>

<style>
  .recovery{margin:12px 0;border:1px solid #343842;border-radius:7px;display:grid;gap:8px}.recovery p{display:flex;justify-content:space-between;gap:12px;margin:0;color:#9299a7}.recovery b{color:#ddd}.recovery details{margin:0}.recovery summary{cursor:pointer}.recovery ul{display:grid;gap:7px;padding-left:20px;color:#aeb4bf;font-size:12px;line-height:1.45}.recovery small{color:#9ca3af;line-height:1.45}
</style>
