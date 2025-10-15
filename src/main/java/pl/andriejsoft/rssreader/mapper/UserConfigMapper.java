package pl.andriejsoft.rssreader.mapper;

import java.util.List;
import org.springframework.stereotype.Component;
import pl.andriejsoft.rssreader.dto.UserConfigDto;
import pl.andriejsoft.rssreader.entity.UserConfigEntity;

@Component
public class UserConfigMapper {

  public List<UserConfigDto> mapToDtoList(List<UserConfigEntity> userConfigEntities) {
    return userConfigEntities.stream().map(this::mapToDto).toList();
  }

  public UserConfigDto mapToDto(UserConfigEntity userConfigEntity) {
    return UserConfigDto.builder()
        .id(userConfigEntity.getId())
        .userName(userConfigEntity.getUserName())
        .userConfigPayload(userConfigEntity.getUserConfigPayload())
        .build();
  }

  public List<UserConfigEntity> mapToEntityList(List<UserConfigDto> userConfigDtos) {
    return userConfigDtos.stream().map(this::mapToEntity).toList();
  }

  public UserConfigEntity mapToEntity(UserConfigDto userConfigDto) {
    return UserConfigEntity.builder()
        .id(userConfigDto.getId())
        .userName(userConfigDto.getUserName())
        .userConfigPayload(userConfigDto.getUserConfigPayload())
        .build();
  }
}
