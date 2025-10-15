package pl.andriejsoft.rssreader.service;

import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.dto.AppConfigDto;
import pl.andriejsoft.rssreader.dto.UserConfigDto;
import pl.andriejsoft.rssreader.dto.UserDto;
import pl.andriejsoft.rssreader.entity.AppConfigEntity;
import pl.andriejsoft.rssreader.entity.UserConfigEntity;
import pl.andriejsoft.rssreader.entity.model.Group;
import pl.andriejsoft.rssreader.entity.model.UserConfigPayload;
import pl.andriejsoft.rssreader.mapper.UserConfigMapper;
import pl.andriejsoft.rssreader.repository.UserConfigRepository;

@Service
public class UserConfigService {

  @Autowired
  private UserConfigRepository userConfigRepository;

  @Autowired
  private AppConfigService appConfigService;

  @Autowired
  private UserConfigMapper userConfigMapper;

  public List<UserConfigDto> findConfigAll() {
    return userConfigMapper.mapToDtoList((List<UserConfigEntity>) userConfigRepository.findAll());
  }

  public UserConfigDto findConfigById(Long id) {
    return userConfigRepository.findById(id).map(i -> userConfigMapper.mapToDto(i)).orElse(null);
  }

  public UserConfigEntity saveConfig(UserConfigDto config) {
    return userConfigRepository.save(userConfigMapper.mapToEntity(config));
  }

  public void deleteConfigById(Long id) {
    userConfigRepository.deleteById(id);
  }

  public List<UserDto> findUserAll() {
    return ((List<UserConfigEntity>) userConfigRepository.findAll()).stream()
        .map(i -> UserDto.builder()
            .id(i.getId())
            .userName(i.getUserName())
            .build()).toList();
  }

  @Cacheable("config")
  public UserConfigDto getCurrentUserConfig() {
    AppConfigDto appConfig = appConfigService.getConfig();
    return userConfigRepository.findById(appConfig.getAppConfigPayload().getDefaultUserId())
        .map(i -> userConfigMapper.mapToDto(i)).orElse(null);
  }

  @CacheEvict(value = "config", allEntries = true)
  public UserDto createNewUser(UserDto userDto) {
    UserDto newUser = Optional.of(userConfigRepository.save(UserConfigEntity.builder()
            .userName(userDto.getUserName())
            .userConfigPayload(UserConfigPayload.builder()
                .defaultCronExpression("0 */15 * ? * *")
                .groups(List.of(Group.builder()
                    .name("DEFAULT")
                    .build()))
                .build())
            .build()))
        .map(i -> UserDto.builder()
            .id(i.getId())
            .userName(i.getUserName())
            .build()).orElse(null);

    AppConfigEntity appConfigEntity = appConfigService.getAppConfig();
    appConfigEntity.getAppConfigPayload().setDefaultUserId(newUser.getId());
    appConfigService.saveConfig(appConfigEntity);
    return newUser;
  }
}
