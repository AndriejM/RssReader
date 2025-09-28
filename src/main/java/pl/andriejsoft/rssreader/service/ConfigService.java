package pl.andriejsoft.rssreader.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.document.Config;
import pl.andriejsoft.rssreader.repository.ConfigRepository;

import java.util.List;
import java.util.Optional;

@Service
public class ConfigService {

    @Autowired
    private ConfigRepository configRepository;

    public List<Config> findAll() {
        return configRepository.findAll();
    }

    public Optional<Config> findById(String uuid) {
        return configRepository.findByUuid(uuid);
    }

    public Config save(Config config) {
        return configRepository.save(config);
    }

    public Config deleteByUuid(String uuid) {
        return configRepository.deleteByUuid(uuid);
    }
}
