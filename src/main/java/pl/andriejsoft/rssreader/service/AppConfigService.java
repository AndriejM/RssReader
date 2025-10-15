package pl.andriejsoft.rssreader.service;

import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.dto.AppConfigDto;
import pl.andriejsoft.rssreader.dto.UserDto;
import pl.andriejsoft.rssreader.entity.AppConfigEntity;
import pl.andriejsoft.rssreader.mapper.AppConfigMapper;
import pl.andriejsoft.rssreader.repository.AppConfigRepository;

@Service
public class AppConfigService {

  @Autowired
  private AppConfigRepository appConfigRepository;

  @Autowired
  private AppConfigMapper appConfigMapper;
  @Autowired
  private UserConfigService userConfigService;

  public AppConfigDto getConfig() {
    AppConfigEntity result = getAppConfig();
    if (result == null) {
      return null;
    }
    return appConfigMapper.mapToDto(result);
  }

  public AppConfigEntity getAppConfig() {
    List<AppConfigEntity> results = (List<AppConfigEntity>) appConfigRepository.findAll();
    if (results.isEmpty()) {
      return null;
    }
    return results.getFirst();
  }

  public AppConfigEntity saveConfig(AppConfigEntity config) {
    return appConfigRepository.save(config);
  }

  @CacheEvict(value = "config", allEntries = true)
  public AppConfigDto setCurrentUser(Long userId) {
    AppConfigEntity appConfigEntity = getAppConfig();
    appConfigEntity.getAppConfigPayload().setDefaultUserId(userId);
    AppConfigEntity config = appConfigRepository.save(appConfigEntity);
    return appConfigMapper.mapToDto(config);
  }
}
