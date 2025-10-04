package pl.andriejsoft.rssreader.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.entity.ConfigEntity;
import pl.andriejsoft.rssreader.repository.ConfigRepository;

import java.util.List;
import java.util.Optional;

@Service
public class ConfigService {

    @Autowired
    private ConfigRepository configRepository;

    public List<ConfigEntity> findAll() {
        return (List<ConfigEntity>)configRepository.findAll();
    }

    public Optional<ConfigEntity> findById(Long id) {
        return configRepository.findById(id);
    }

    public ConfigEntity save(ConfigEntity config) {
        return configRepository.save(config);
    }

    public void deleteById(Long id) {
        configRepository.deleteById(id);
    }
}
